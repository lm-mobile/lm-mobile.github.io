/*
 * Learnable Meta mobile relay (Cloudflare Worker)
 * ------------------------------------------------
 * 1. Sends visitors of  /  to the guide website (SITE_URL)
 * 2. Serves the mobile loader at          /lm-mobile.js
 * 3. Relays learnablemeta.com/api/userscript/* with CORS headers so a plain
 *    page script running on geoguessr.com is allowed to call it.
 *
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

const SITE_URL = 'https://lm-mobile-guide.github.io/';
const UPSTREAM = 'https://learnablemeta.com';
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*geoguessr\.com$/i;
const FORWARD_AUTHORIZATION = false;
const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept'];

const LOADER = String.raw`
/*
 * Learnable Meta mobile loader
 * ----------------------------
 * Runs the official "GeoGuessr Learnable Meta" userscript inside a normal
 * browser tab (Chrome / Brave / Safari on a phone or tablet) that has no
 * userscript manager. It fakes the small set of GM_* functions the userscript
 * asks for, downloads the real userscript from its official host, and runs it.
 *
 * Network calls to learnablemeta.com/api/... are sent through the relay that
 * served this file (see worker.js), because that API has no CORS headers and a
 * plain page script is not allowed to call it directly.
 *
 * Late-injection fix: a userscript manager starts the script before GeoGuessr
 * loads, so the script's event framework can wrap window.fetch and watch game
 * requests. A bookmarklet starts after GeoGuessr has already kept a private
 * copy of fetch, so that wrapper never sees anything. This loader therefore
 * watches Response.prototype.json (which GeoGuessr's client does call), and
 * also fetches the current game state once at start, then hands the data to
 * the event framework itself.
 *
 * Trigger it from a bookmarklet while you are on geoguessr.com:
 *   javascript:(function(){var s=document.createElement('script');s.src='https://YOUR-WORKER.workers.dev/lm-mobile.js?'+Date.now();document.head.appendChild(s);})();
 *
 * Do not use backticks or a dollar sign followed by a brace in this file: it is embedded in worker.js as a raw string.
 */
(function () {
  'use strict';

  var API_ORIGIN = 'https://learnablemeta.com';
  var SCRIPT_URL = 'https://userscript.learnablemeta.com/geometa.user.js';
  var STORE_PREFIX = 'lmMobile:';
  var LOADER_VERSION = '1.1.0';
  var GAME_API = /geoguessr\.com\/api\/v3\/(games|challenges)(\/|$)/;

  if (!/(^|\.)geoguessr\.com$/.test(location.hostname)) {
    alert('Open geoguessr.com first, then tap the Learnable Meta bookmark.');
    return;
  }
  if (window.__lmMobile) {
    window.__lmMobile.notify('Learnable Meta is already running on this page.');
    return;
  }

  var relay = window.__LM_RELAY || '';
  if (!relay && document.currentScript && document.currentScript.src) {
    relay = new URL(document.currentScript.src).origin;
  }

  var nativeFetch = window.fetch;
  var state = {
    relay: relay,
    menu: [],
    notify: notify,
    version: LOADER_VERSION,
    diag: { events: [], jsonHookHits: 0, lastGameResponse: '', lastSync: '', lastGame: null, errors: [] }
  };
  window.__lmMobile = state;

  window.addEventListener('error', function (e) {
    if (e && e.message && state.diag.errors.length < 20) state.diag.errors.push(String(e.message));
  });

  /* ---------- tiny UI helpers (toast + menu button) ---------- */

  function el(tag, css, text) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text) node.textContent = text;
    return node;
  }

  function notify(message, ms) {
    var toast = el('div',
      'position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:2147483647;' +
      'max-width:90vw;padding:10px 14px;border-radius:8px;background:#1c1836;color:#fff;' +
      'font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:none',
      message);
    (document.body || document.documentElement).appendChild(toast);
    setTimeout(function () { toast.remove(); }, ms || 3500);
    console.log('LM mobile: ' + message);
  }

  var menuPanel = null;
  function ensureMenuButton() {
    if (document.getElementById('lm-mobile-menu-btn')) return;
    var btn = el('button',
      'position:fixed;right:12px;bottom:12px;z-index:2147483646;width:44px;height:44px;border-radius:50%;' +
      'border:0;background:#1c1836;color:#fff;font:700 13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);' +
      'opacity:.85;cursor:pointer', 'LM');
    btn.id = 'lm-mobile-menu-btn';
    btn.title = 'Learnable Meta menu';
    btn.addEventListener('click', toggleMenu);
    (document.body || document.documentElement).appendChild(btn);
  }

  function menuRow(caption, color, onClick) {
    var row = el('button',
      'display:block;width:100%;text-align:left;padding:10px 8px;border:0;border-radius:6px;background:transparent;' +
      'color:' + color + ';font:14px system-ui,sans-serif;cursor:pointer', caption);
    row.addEventListener('click', onClick);
    return row;
  }

  function toggleMenu() {
    if (menuPanel) { menuPanel.remove(); menuPanel = null; return; }
    menuPanel = el('div',
      'position:fixed;right:12px;bottom:64px;z-index:2147483646;min-width:220px;max-width:90vw;padding:8px;border-radius:10px;' +
      'background:#1c1836;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5)');
    menuPanel.appendChild(el('div', 'padding:4px 8px 8px;font-weight:700;opacity:.8', 'Learnable Meta (mobile loader ' + LOADER_VERSION + ')'));
    state.menu.forEach(function (item) {
      menuPanel.appendChild(menuRow(item.caption, '#fff', function () {
        toggleMenu();
        try { item.fn(); } catch (e) { console.error('LM mobile: menu command failed', e); }
      }));
    });
    menuPanel.appendChild(menuRow('Check game now', '#fff', function () { toggleMenu(); syncGame('manual'); notify('Checking current game...'); }));
    menuPanel.appendChild(menuRow('Diagnostics', '#fff', function () { toggleMenu(); showDiagnostics(); }));
    menuPanel.appendChild(menuRow('Reload page (script stops until you tap the bookmark again)', '#9ad', function () { location.reload(); }));
    (document.body || document.documentElement).appendChild(menuPanel);
  }

  function diagnosticsText() {
    var gef = window.GeoGuessrEventFramework;
    var info = {
      loader: LOADER_VERSION,
      userscript: state.userscriptVersion || 'not loaded',
      relay: relay || 'none',
      page: location.href,
      screen: window.innerWidth + 'x' + window.innerHeight,
      browser: navigator.userAgent,
      eventFramework: gef ? 'present' : 'missing',
      gefState: gef ? { game: gef.state.current_game_id, round: gef.state.current_round, map: gef.state.map, roundInProgress: gef.state.round_in_progress } : null,
      gameTokenFromPage: currentGameToken() || 'none',
      resultViewOnScreen: !!document.querySelector('div[data-qa="result-view-top"]'),
      metaWindowOnScreen: !!document.querySelector('.geometa-container'),
      jsonHookHits: state.diag.jsonHookHits,
      lastGameResponse: state.diag.lastGameResponse || 'none yet',
      lastSync: state.diag.lastSync || 'none yet',
      lastGame: state.diag.lastGame,
      events: state.diag.events.slice(-12),
      errors: state.diag.errors
    };
    return JSON.stringify(info, null, 2);
  }

  function showDiagnostics() {
    var box = el('div',
      'position:fixed;inset:12px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;' +
      'background:#1c1836;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.6)');
    box.appendChild(el('div', 'font-weight:700', 'Learnable Meta diagnostics (long-press the text to copy it)'));
    var area = el('textarea', 'flex:1;width:100%;box-sizing:border-box;background:#0f0d1c;color:#dcd8f0;border:1px solid #3a3560;border-radius:8px;padding:8px;font:12px ui-monospace,Menlo,Consolas,monospace');
    area.readOnly = true;
    area.value = diagnosticsText();
    box.appendChild(area);
    var buttons = el('div', 'display:flex;gap:8px');
    var copy = el('button', 'padding:10px 14px;border:0;border-radius:8px;background:#7c5cff;color:#fff;font-weight:700', 'Copy');
    copy.addEventListener('click', function () {
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(area.value).then(function () { copy.textContent = 'Copied'; }, function () { copy.textContent = ok ? 'Copied' : 'Select text and copy'; });
      } else {
        copy.textContent = ok ? 'Copied' : 'Select text and copy';
      }
    });
    var close = el('button', 'padding:10px 14px;border:0;border-radius:8px;background:#2d2850;color:#fff', 'Close');
    close.addEventListener('click', function () { box.remove(); });
    buttons.appendChild(copy);
    buttons.appendChild(close);
    box.appendChild(buttons);
    (document.body || document.documentElement).appendChild(box);
  }

  /* ---------- GM_* API shims ---------- */

  window.unsafeWindow = window;

  window.GM_getValue = function (key, defaultValue) {
    try {
      var raw = localStorage.getItem(STORE_PREFIX + key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch (e) {
      return defaultValue;
    }
  };

  window.GM_setValue = function (key, value) {
    try {
      if (value === undefined) localStorage.removeItem(STORE_PREFIX + key);
      else localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.warn('LM mobile: could not save ' + key, e);
    }
  };

  window.GM_deleteValue = function (key) {
    try { localStorage.removeItem(STORE_PREFIX + key); } catch (e) { /* ignore */ }
  };

  window.GM_addStyle = function (css) {
    var style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  };

  window.GM_registerMenuCommand = function (caption, fn) {
    state.menu.push({ caption: String(caption), fn: fn });
    ensureMenuButton();
    return state.menu.length;
  };

  window.GM_xmlhttpRequest = function (details) {
    details = details || {};
    var url = String(details.url || '');
    if (url.indexOf(API_ORIGIN + '/api/') === 0) {
      if (!relay) {
        console.warn('LM mobile: no relay configured, calling ' + url + ' directly (only works if learnablemeta.com sends CORS headers)');
      } else {
        url = relay + url.slice(API_ORIGIN.length);
      }
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var timer = null;
    if (details.timeout && controller) {
      timer = setTimeout(function () { timedOut = true; controller.abort(); }, details.timeout);
    }
    var options = {
      method: details.method || 'GET',
      headers: details.headers || {},
      credentials: 'omit',
      cache: 'no-store'
    };
    if (details.data !== undefined && details.data !== null) options.body = details.data;
    if (controller) options.signal = controller.signal;

    nativeFetch.call(window, url, options).then(function (res) {
      return res.text().then(function (text) {
        if (timer) clearTimeout(timer);
        var lines = [];
        res.headers.forEach(function (value, name) { lines.push(name + ': ' + value); });
        var response = {
          status: res.status,
          statusText: res.statusText,
          readyState: 4,
          responseText: text,
          response: text,
          responseHeaders: lines.join('\r\n'),
          finalUrl: res.url || url
        };
        if (typeof details.onload === 'function') details.onload(response);
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      var response = {
        status: 0, statusText: String(err), readyState: 4, responseText: '', response: null,
        responseHeaders: '', finalUrl: url, error: String(err)
      };
      if (timedOut && typeof details.ontimeout === 'function') details.ontimeout(response);
      else if (typeof details.onerror === 'function') details.onerror(response);
      else console.error('LM mobile: request failed ' + url, err);
    });

    return { abort: function () { if (controller) controller.abort(); } };
  };

  /* ---------- late-injection fix: feed game data to the event framework ---------- */

  var ownResponses = typeof WeakSet === 'function' ? new WeakSet() : { add: function () {}, has: function () { return false; } };
  var lastFinishedKey = '';

  function logEvent(name, detail) {
    state.diag.events.push(new Date().toISOString().slice(11, 19) + ' ' + name + (detail ? ' ' + detail : ''));
    if (state.diag.events.length > 40) state.diag.events.shift();
  }

  function feedGame(data, source) {
    var gef = window.GeoGuessrEventFramework;
    if (!gef || !gef.state || typeof gef.startRound !== 'function') { logEvent('game data ignored, framework missing', source); return; }
    if (!data || !data.token || !data.round || !data.player || !Array.isArray(data.player.guesses)) { logEvent('game data ignored, unexpected shape', source); return; }
    var copy;
    try { copy = JSON.parse(JSON.stringify(data)); } catch (e) { copy = data; }
    var finished = copy.player.guesses.length === copy.round;
    var isNew = copy.round !== gef.state.current_round || copy.token !== gef.state.current_game_id;
    state.diag.lastGame = { token: copy.token, round: copy.round, finished: finished, map: copy.map, source: source };
    try {
      if (isNew) { gef.startRound(copy); logEvent('round_start fed', 'round ' + copy.round + ' via ' + source); }
      if (finished) {
        var key = copy.token + ':' + copy.round;
        if (lastFinishedKey !== key) {
          lastFinishedKey = key;
          gef.stopRound(copy);
          logEvent('round_end fed', 'round ' + copy.round + ' via ' + source);
        }
      }
    } catch (e) {
      console.error('LM mobile: could not feed game data', e);
      state.diag.errors.push('feedGame: ' + e.message);
    }
  }
  state.feedGame = feedGame;

  var origJson = Response.prototype.json;
  Response.prototype.json = function () {
    var promise = origJson.apply(this, arguments);
    var url = this.url || '';
    if (!ownResponses.has(this) && GAME_API.test(url) && url.indexOf('daily-challenge') === -1) {
      state.diag.jsonHookHits += 1;
      state.diag.lastGameResponse = url;
      promise.then(function (data) { feedGame(data, 'response'); }, function () {});
    }
    return promise;
  };

  function currentGameToken() {
    var path = location.pathname.replace(/^\/[a-z]{2}(-[A-Za-z]{2})?(?=\/)/, '');
    var m = path.match(/^\/game\/([^\/?#]+)/);
    if (m) return m[1];
    var onChallenge = /^\/challenge\//.test(path);
    if (!onChallenge) return '';
    try {
      var entries = performance.getEntriesByType('resource');
      for (var i = entries.length - 1; i >= 0; i--) {
        var mm = entries[i].name.match(/geoguessr\.com\/api\/v3\/games\/([^\/?#]+)/);
        if (mm) return mm[1];
      }
    } catch (e) { /* ignore */ }
    try {
      var snap = window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps && window.__NEXT_DATA__.props.pageProps.gameSnapshot;
      if (snap && snap.token) return snap.token;
    } catch (e) { /* ignore */ }
    return '';
  }

  function syncGame(reason) {
    var token = currentGameToken();
    if (!token) { state.diag.lastSync = reason + ': no game on this page'; return; }
    state.diag.lastSync = reason + ': fetching game ' + token;
    nativeFetch.call(window, 'https://www.geoguessr.com/api/v3/games/' + token, { credentials: 'include', cache: 'no-store' })
      .then(function (res) {
        ownResponses.add(res);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) { state.diag.lastSync = reason + ': got round ' + data.round; feedGame(data, 'sync ' + reason); })
      .catch(function (e) { state.diag.lastSync = reason + ': failed, ' + e.message; console.warn('LM mobile: game sync failed', e); });
  }
  state.syncGame = syncGame;

  function watchFrameworkEvents() {
    var gef = window.GeoGuessrEventFramework;
    if (!gef || !gef.events) return;
    ['game_start', 'round_start', 'round_end', 'game_end'].forEach(function (name) {
      gef.events.addEventListener(name, function (e) {
        var d = e && e.detail;
        logEvent(name, d ? 'round ' + d.current_round + (d.map ? ' map ' + d.map.id : '') : '');
      });
    });
  }

  var urlSyncTimer = null;
  function onUrlChange() {
    clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(function () { syncGame('url change'); }, 1500);
  }
  window.addEventListener('urlchange', onUrlChange);
  window.addEventListener('popstate', onUrlChange);

  /* ---------- small-screen tweak for the meta window ---------- */

  window.GM_addStyle(
    '@media (max-width: 700px) {' +
    ' .geometa-container { width: min(92vw, 500px) !important; left: 4vw !important; top: 4.5rem !important; max-height: 55vh !important; font-size: 15px !important; }' +
    '}'
  );

  /* ---------- fetch and run the real userscript ---------- */

  function runInline(code, label) {
    var script = document.createElement('script');
    script.textContent = code + '\n//# sourceURL=' + label;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function download(url) {
    return nativeFetch.call(window, url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return res.text();
    });
  }

  notify('Loading Learnable Meta...');
  download(SCRIPT_URL).then(function (source) {
    var header = (source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/) || ['', ''])[1];
    var versionMatch = header.match(/@version\s+(\S+)/);
    var requires = [];
    header.replace(/@require\s+(\S+)/g, function (_, u) { requires.push(u); return ''; });

    window.GM_info = {
      script: { name: 'GeoGuessr Learnable Meta', namespace: 'geometa', version: versionMatch ? versionMatch[1] : '0' },
      scriptHandler: 'Learnable Meta mobile loader',
      version: LOADER_VERSION
    };

    return requires.reduce(function (chain, reqUrl) {
      return chain.then(function () {
        return download(reqUrl).then(function (code) { runInline(code, reqUrl); });
      });
    }, Promise.resolve()).then(function () {
      runInline(source, SCRIPT_URL);
      state.userscriptVersion = window.GM_info.script.version;
      ensureMenuButton();
      watchFrameworkEvents();
      notify('Learnable Meta ' + window.GM_info.script.version + ' loaded');
      setTimeout(function () { syncGame('start'); }, 800);
    });
  }).catch(function (err) {
    console.error('LM mobile: failed to start', err);
    state.diag.errors.push('start: ' + err.message);
    notify('Learnable Meta failed to load: ' + err.message, 6000);
  });
})();
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
