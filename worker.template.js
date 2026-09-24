/*
 * Learnable Meta mobile relay (Cloudflare Worker)
 * ------------------------------------------------
 * 1. Sends visitors of  /  to the guide website (SITE_URL)
 * 2. Serves the mobile loader at          /lm-mobile.js
 * 3. Relays learnablemeta.com/api/userscript/* with CORS headers so a plain
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
