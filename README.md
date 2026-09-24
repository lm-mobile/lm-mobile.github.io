# Learnable Meta on any browser

Run the GeoGuessr **Learnable Meta** userscript on a phone, tablet or computer
in Chrome, Brave, Edge, Samsung Internet or Safari, with no userscript manager.
A bookmark loads the official, unmodified script into the GeoGuessr page; a tiny
free relay lets it reach the Learnable Meta server.

**Guide website:** https://lm-mobile.github.io/ (the `docs` folder, published by GitHub Pages)
Pages: home, Android, iPhone and iPad,
Play, Help, Host your own.

**Relay:** https://lm-relay.overlaisupport.workers.dev (the address the bookmark uses)

## What the player does

| When | What | Effort |
| --- | --- | --- |
| Once per device | Open the guide, tap "Copy bookmark link", save it as a bookmark named LM | About five taps on a phone, one drag on a computer |
| Each play session | On geoguessr.com, type LM in the address bar and tap the bookmark | One tap |
| iPhone or iPad (optional) | Share menu, then the Learnable Meta shortcut | Two taps |

It cannot be less than this. No browser lets a web page add a bookmark for the
user, and without an extension the browser forgets the script after a full page
reload.

## How it works

1. The bookmarklet adds a `<script>` tag pointing at `/lm-mobile.js` on the relay.
2. `lm-mobile.js` fakes the six `GM_*` functions the userscript needs, downloads
   the real script from `userscript.learnablemeta.com`, and runs it.
3. Calls to `learnablemeta.com/api/...` go through the relay, which adds the
   CORS headers the Learnable Meta API lacks. Only pages on geoguessr.com may
   use it, and personal tokens are not forwarded.
4. GeoGuessr keeps a private copy of `fetch` from page load, so a script
   injected later cannot watch game requests the way Tampermonkey-installed
   scripts do. The loader hooks `Response.prototype.json` instead, fetches the
   current game once at start, and feeds the data to the script's event
   framework itself. Verified on real games: the meta window appears after each
   guess and closes on the next round.

## Files

| File | What it is |
| --- | --- |
| `worker.js` | Built file: the Cloudflare Worker (relay + loader). Paste into Cloudflare or let Cloudflare deploy it from GitHub. |
| `lm-mobile.js` | The loader source. Embedded into `worker.js` by `build.sh`. |
| `worker.template.js` | Worker source with the `/*__LOADER__*/` placeholder. |
| `build.sh` | Rebuilds `worker.js` after editing the loader or the template. |
| `docs/` | The guide website (one HTML page per topic, `config.js`, `style.css`, `img/`), served by GitHub Pages. |
| `LICENSE` | MIT. The Learnable Meta script itself is not covered; it belongs to its authors. |
| `wrangler.jsonc` | Lets `npx wrangler deploy` and Cloudflare's GitHub integration deploy the worker. |
| `dev-server.mjs` | Runs `worker.js` locally for testing: `node dev-server.mjs 8787`. |
| `bookmarklet.txt` | The bookmark link, for setting it up by hand. |

## Host your own copy

1. **Fork** this repository.
2. **Relay:** at https://dash.cloudflare.com go to Workers & Pages, Create,
   Start with Hello World, name it `lm-relay`, Deploy. Edit code, delete
   everything, paste `worker.js`, Deploy. Note the address.
   Or connect the fork: Workers & Pages, Create, Import a repository. Cloudflare
   then deploys on every push using `wrangler.jsonc`.
   Or from a terminal: `npx wrangler login` then `npx wrangler deploy`.
3. **Point things at each other:** set `relay` and `repo` in `docs/config.js`,
   and `SITE_URL` at the top of `worker.template.js`, then run `bash build.sh`.
4. **Website:** in the fork's Settings, Pages, choose "Deploy from a branch",
   branch `main`, folder `/docs`.

## Sharing the relay

`FORWARD_AUTHORIZATION` in `worker.js` is `false`, so the relay refuses to pass
anyone's personal Learnable Meta token through. Meta explanations do not need a
token, so everything a player uses works; only the map-creator upload feature is
unavailable. Set it to `true` only on a relay that is yours alone. Cloudflare's
free plan allows 100,000 requests per day.

## Troubleshooting

Tap the round **LM** button on the GeoGuessr page:

- **Check game now** re-reads the current game and shows the meta window if a
  round has just ended.
- **Diagnostics** shows what the loader saw: game token, framework state,
  whether the result screen was detected, recent events and errors. Tap Copy and
  send that text along with your report.

## Officially supported alternatives

- Android: Firefox for Android plus Tampermonkey (Learnable Meta's own guide).
- iPhone and iPad: Safari plus the Tampermonkey app (paid) or the free
  Userscripts app.

## Licence

MIT, see `LICENSE`. Not affiliated with GeoGuessr or Learnable Meta. The script
belongs to the Learnable Meta team and is loaded unmodified from their official
address.
