Title: Learnable Meta on your phone (Chrome, Brave, any Chromium browser), no Tampermonkey needed

Body:

If you play the Learnable Meta maps and wished the clue window worked on your phone, I made a small guide and tool for that.

https://lm-mobile.github.io/

How it works: you save one bookmark, named LM, once. In a game you tap it and it loads the official Learnable Meta script into the page. After every guess the clue for that location shows up, same as on a computer. Nothing is installed, nothing on your account changes, and it is free.

What to know:
- Works in Chrome, Brave, Edge, Samsung Internet and other Chromium browsers on Android phones and tablets. Not in the GeoGuessr app, only the website.
- Every new map, tap the bookmark again.
- iPhone and iPad are not supported. Apple does not allow this.
- Firefox users do not need this: Firefox on Android runs Tampermonkey, so the normal Learnable Meta install works there.

Safety: the bookmark loads the unmodified script straight from the Learnable Meta site. A tiny relay in between only forwards the script's requests, stores nothing, never sees your GeoGuessr login, and refuses to pass on Learnable Meta account tokens. The code is open source: https://github.com/lm-mobile/lm-mobile.github.io

This is not affiliated with GeoGuessr or with the Learnable Meta developers. It is a player-made add-on; the script, the maps and the clues are all their work. Their site is https://learnablemeta.com.

Happy to answer questions or fix problems. The Help page on the site has a Diagnostics button you can copy from if something does not work.
