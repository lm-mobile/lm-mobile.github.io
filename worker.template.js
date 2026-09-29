/*
 * Learnable Meta mobile relay (Cloudflare Worker)
 * ------------------------------------------------
 * 1. Sends visitors of  /  to the guide website (SITE_URL)
 * 2. Serves the mobile loader at          /lm-mobile.js
 * 3. Answers /health with 200 or 503 for an uptime monitor (daily-check substitute)
 * 4. Relays learnablemeta.com/api/userscript/* with CORS headers so a plain
 *    page script running on geoguessr.com is allowed to call it.
 *
 * Deploys automatically from GitHub (Workers Builds) on every push to main.
 * Deploy by hand: Cloudflare dashboard -> Workers & Pages -> your worker
 *                 -> Edit code -> replace everything with this file -> Deploy.
 * Deploy from GitHub: Workers & Pages -> Create -> Import a repository, pick
 *                 this repo; Cloudflare then redeploys on every push.
 *
 * Only requests whose Origin is a geoguessr.com page are relayed.
 *
 * FORWARD_AUTHORIZATION: keep false if other people will use your relay. The
 * meta explanations work without a token. Only map-creator upload features need
 * a personal Learnable Meta token, and with false the relay refuses to pass one
 * through, so nobody's secret ever travels through your worker. Set it to true
 * only on a relay that is yours alone.
 */

const SITE_URL = 'https://lm-mobile.github.io/';
const UPSTREAM = 'https://learnablemeta.com';
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*geoguessr\.com$/i;
const FORWARD_AUTHORIZATION = false;
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept'];

const LOADER = String.raw`
/*__LOADER__*/
`;


/*
 * /health runs the checks that need no GeoGuessr login and answers 200 when all pass,
 * 503 when something the bookmark depends on has changed. Point an uptime monitor at it.
 * Results are cached for 30 minutes so frequent polling stays cheap.
 */
const SCRIPT_URL = 'https://userscript.learnablemeta.com/geometa.user.js';
const SHIMMED_GRANTS = ['GM_addStyle', 'GM_getValue', 'GM_info', 'GM_registerMenuCommand', 'GM_setValue', 'GM_xmlhttpRequest', 'unsafeWindow', 'GM_deleteValue'];
const TEST_MAP = '66fda352ee1c8ee4735e1aa8';
let healthCache = null;

async function runHealthChecks() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const get = (u, init) => fetch(u, Object.assign({ headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' } }, init || {}));

  let script = '';
  try {
    const r = await get(SCRIPT_URL);
    script = r.ok ? await r.text() : '';
    add('official script reachable', r.ok && script.length > 50000, 'HTTP ' + r.status + ', ' + script.length + ' bytes');
  } catch (e) { add('official script reachable', false, String(e)); }

  if (script) {
    const header = (script.match(/==UserScript==([\s\S]*?)==\/UserScript==/) || ['', ''])[1];
    const version = (header.match(/@version\s+(\S+)/) || [])[1] || 'unknown';
    const grants = Array.from(header.matchAll(/@grant\s+(\S+)/g)).map((m) => m[1]);
    const unknown = grants.filter((g) => SHIMMED_GRANTS.indexOf(g) === -1);
    add('script asks only for functions the loader provides', unknown.length === 0, 'version ' + version + (unknown.length ? ', new: ' + unknown.join(', ') : ', grants ok'));
    const markers = ['GeoGuessrEventFramework', 'result-view-top', '/api/userscript/location', 'round_end'];
    const missing = markers.filter((m) => script.indexOf(m) === -1);
    add('script still uses the parts the loader feeds', missing.length === 0, missing.length ? 'missing: ' + missing.join(', ') : 'markers ok');
    const requires = Array.from(header.matchAll(/@require\s+(\S+)/g)).map((m) => m[1]);
    for (const req of requires) {
      try {
        const r = await get(req);
        const body = r.ok ? await r.text() : '';
        const okBody = ['startRound', 'stopRound', 'GeoGuessrEventFramework'].every((m) => body.indexOf(m) !== -1);
        add('event framework reachable and unchanged', r.ok && okBody, 'HTTP ' + r.status + (okBody ? '' : ', expected functions missing'));
      } catch (e) { add('event framework reachable and unchanged', false, String(e)); }
    }
  }

  try {
    const r = await get(UPSTREAM + '/api/userscript/map/' + TEST_MAP);
    const j = r.ok ? await r.json() : null;
    add('Learnable Meta API answers', !!(j && j.mapFound === true), 'HTTP ' + r.status);
  } catch (e) { add('Learnable Meta API answers', false, String(e)); }

  try {
    const r = await get('https://www.geoguessr.com/');
    if (r.status === 200) {
      const csp = r.headers.get('content-security-policy') || '';
      const blocks = /script-src|default-src|require-trusted-types-for/i.test(csp);
      add('GeoGuessr allows the bookmark to add scripts', !blocks, blocks ? 'policy: ' + csp.slice(0, 200) : 'no blocking policy');
    } else {
      add('GeoGuessr allows the bookmark to add scripts', null, 'could not check, HTTP ' + r.status);
    }
  } catch (e) { add('GeoGuessr allows the bookmark to add scripts', null, 'could not check: ' + String(e)); }

  const loaderVersion = (LOADER.match(/LOADER_VERSION = '([^']+)'/) || [])[1] || 'unknown';
  const failed = checks.filter((c) => c.ok === false);
  return { ok: failed.length === 0, loader: loaderVersion, checkedAt: new Date().toISOString(), failed: failed.map((c) => c.name), checks };
}

async function health(force) {
  if (!force && healthCache && Date.now() - healthCache.at < 30 * 60 * 1000) return healthCache.result;
  const result = await runHealthChecks();
  healthCache = { at: Date.now(), result };
  return result;
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/install') {
      return Response.redirect(SITE_URL, 302);
    }

    if (url.pathname === '/health') {
      const result = await health(url.searchParams.has('fresh'));
      return new Response((result.ok ? 'OK' : 'PROBLEM') + '\n' + JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    if (url.pathname === '/lm-mobile.js') {
      return new Response(LOADER, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-cache',
          'access-control-allow-origin': '*'
        }
      });
    }

    if (url.pathname.startsWith('/api/userscript/')) {
      const origin = request.headers.get('Origin') || '';
      if (!ALLOWED_ORIGIN.test(origin)) {
        return new Response('Forbidden: only geoguessr.com pages may use this relay', { status: 403 });
      }
      const cors = corsHeaders(origin);
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }

      const headers = new Headers();
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      const auth = request.headers.get('authorization');
      if (auth) {
        if (!FORWARD_AUTHORIZATION) {
          return new Response(JSON.stringify({
            message: 'This relay does not forward Learnable Meta tokens, so map-creator features are unavailable here. Meta explanations still work.'
          }), { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
        }
        headers.set('authorization', auth);
      }
      headers.set('user-agent', 'learnable-meta-mobile-relay');

      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: 'follow'
      });

      const out = new Headers(cors);
      const contentType = upstream.headers.get('content-type');
      if (contentType) out.set('content-type', contentType);
      out.set('cache-control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
    }

    return new Response('Not found. The guide is at ' + SITE_URL, {
      status: 404, headers: { 'content-type': 'text/plain' }
    });
  }
};
