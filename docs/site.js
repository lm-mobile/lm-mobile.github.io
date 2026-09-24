(function () {
  var cfg = window.LM_CONFIG || {};
  var relay = String(cfg.relay || location.origin).replace(/\/+$/, '');
  var repo = cfg.repo || '';
  var bookmarklet = "javascript:(function(){var s=document.createElement('script');s.src='" + relay + "/lm-mobile.js?'+Date.now();document.head.appendChild(s);})();";
  var shortcut = "var s=document.createElement('script');s.src='" + relay + "/lm-mobile.js?'+Date.now();document.head.appendChild(s);completion();";
  var texts = { bookmarklet: bookmarklet, shortcut: shortcut };

  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  all('[data-fill]').forEach(function (el) {
    var t = texts[el.getAttribute('data-fill')];
    if (t === undefined) return;
    if ('value' in el) el.value = t; else el.textContent = t;
  });

  all('a[data-drag]').forEach(function (a) {
    a.href = bookmarklet;
    a.addEventListener('click', function (e) {
      e.preventDefault();
      alert('Drag this button to the bookmarks bar instead of clicking it. On a phone, use the Copy bookmark link button.');
    });
  });

  all('[data-copy]').forEach(function (btn) {
    var text = texts[btn.getAttribute('data-copy')];
    var out = btn.nextElementSibling;
    btn.addEventListener('click', function () {
      var done = function () { if (out) out.textContent = 'Copied'; };
      var fail = function () { if (out) out.textContent = 'Could not copy, open the box below and copy it by hand'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
      else fail();
    });
  });

  all('a[data-repo]').forEach(function (a) { if (repo) a.href = repo; });
  all('[data-repo-only]').forEach(function (el) { if (!repo) el.style.display = 'none'; });
  all('[data-relay-url]').forEach(function (el) { el.textContent = relay; });

  var status = document.querySelector('[data-relay-status]');
  if (status) {
    fetch(relay + '/lm-mobile.js', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (t) {
        var m = t.match(/LOADER_VERSION = '([^']+)'/);
        status.innerHTML = '<span class="ok">Relay is online</span> at ' + relay + (m ? ', loader ' + m[1] : '');
      })
      .catch(function (e) {
        status.innerHTML = '<span class="warn">Relay check failed: ' + e.message + '</span> (' + relay + ')';
      });
  }

  var here = location.pathname.split('/').pop() || 'index.html';
  all('nav.menu a').forEach(function (a) {
    if ((a.getAttribute('href') || '') === here) a.classList.add('current');
  });
})();
