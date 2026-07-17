/* Small "ask for one line of text" modal — the ZBXi replacement for the
   browser's unstylable prompt(). Used by the Admin + Officer consoles.
   ZBXIAsk.text({title, rows, placeholder, value, ok, validate}, cb) calls
   cb(value) only on OK; Cancel / Esc / ✕ / backdrop close silently.
   validate(v) may return a warning string: it shows inline and the OK
   button becomes "Use it anyway" — a second OK accepts as typed. */
(function () {
  'use strict';
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }

  function text(opts, cb) {
    opts = opts || {};
    var old = document.getElementById('zbxiAsk');
    if (old) old.remove();

    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.id = 'zbxiAsk';
    wrap.innerHTML =
      '<div class="admin-modal__card admin-modal__card--ask" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || '') + '">' +
        '<button class="admin-modal__close" type="button" aria-label="Close">✕</button>' +
        '<h3>' + esc(opts.title || 'Enter a value') + '</h3>' +
        (opts.rows && opts.rows.length
          ? '<div class="ask-rows">' + opts.rows.map(function (r) {
              return '<div><span>' + esc(r[0]) + ':</span><b>' + esc(r[1]) + '</b></div>';
            }).join('') + '</div>'
          : '') +
        '<input class="ask-input" type="text" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '">' +
        '<p class="ask-warn" hidden></p>' +
        '<div class="ask-actions">' +
          '<button class="btn btn--ghost" type="button" data-cancel>Cancel</button>' +
          '<button class="btn btn--gold" type="button" data-ok>' + esc(opts.ok || 'OK') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var input = wrap.querySelector('.ask-input');
    var warnEl = wrap.querySelector('.ask-warn');
    var okBtn = wrap.querySelector('[data-ok]');
    var warned = false;

    function close() { wrap.remove(); document.removeEventListener('keydown', onEsc); }
    function onEsc(e) { if (e.key === 'Escape') close(); }

    function accept() {
      var v = input.value.trim();
      if (!v) { input.focus(); return; }
      if (opts.validate && !warned) {
        var w = opts.validate(v);
        if (w) {
          warned = true;
          warnEl.textContent = '⚠ ' + w;
          warnEl.hidden = false;
          okBtn.textContent = 'Use it anyway';
          input.focus();
          return;
        }
      }
      close();
      cb(v);
    }

    // Editing after a warning resets it — the new text gets validated fresh.
    input.addEventListener('input', function () {
      if (!warned) return;
      warned = false;
      warnEl.hidden = true;
      okBtn.textContent = opts.ok || 'OK';
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); accept(); } });
    okBtn.onclick = accept;
    wrap.querySelector('[data-cancel]').onclick = close;
    wrap.querySelector('.admin-modal__close').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onEsc);
    input.focus();
  }

  window.ZBXIAsk = { text: text };
})();
