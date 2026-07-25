/* ZBXi themed dialogs — replacements for the browser's unstylable prompt() /
   confirm() / alert(). Used by the Admin + Officer consoles and the brother
   portal. All three close on Esc / ✕ / backdrop / Cancel and RETURN FOCUS to
   whatever element opened them.
     ZBXIAsk.text({title, rows, placeholder, value, ok, validate}, cb)
        — cb(value) only on OK; Cancel / Esc / ✕ / backdrop close silently.
        — validate(v) may return a warning string: it shows inline and the OK
          button becomes "Use it anyway" — a second OK accepts as typed.
     ZBXIAsk.confirm({title, body, ok, cancel, danger}, cb, onCancel?)
        — cb() on OK; optional onCancel() on Esc / Cancel / backdrop dismissal.
          Destructive dialogs (danger:true) render a red OK and default-focus Cancel.
     ZBXIAsk.alert({title, body, ok}, cb?)
        — single button; cb?() fires once the notice is dismissed (any path). */
(function () {
  'use strict';
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  // Dialog bodies carried \n line breaks in the native calls they replace — keep them.
  function bodyHtml(s) { return esc(s).replace(/\n/g, '<br>'); }

  /* Shared shell: builds the backdrop + card, wires Esc / backdrop / ✕ close and
     focus-return. `inner` is the card's inner HTML (after the ✕ button). Returns
     the wrap element + a close(). `onClose`, if given, fires on EVERY dismissal
     path (alert uses it so its callback runs however the notice is dismissed). */
  function shell(inner, ariaLabel, onClose) {
    var opener = document.activeElement;
    var old = document.getElementById('zbxiAsk');
    if (old) old.remove();

    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';
    wrap.id = 'zbxiAsk';
    wrap.innerHTML =
      '<div class="admin-modal__card admin-modal__card--ask" role="dialog" aria-modal="true" aria-label="' + esc(ariaLabel || '') + '">' +
        '<button class="admin-modal__close" type="button" aria-label="Close">✕</button>' +
        inner +
      '</div>';
    document.body.appendChild(wrap);

    function close() {
      wrap.remove();
      document.removeEventListener('keydown', onEsc);
      if (opener && opener.focus) { try { opener.focus(); } catch (e) {} }
      if (onClose) onClose();
    }
    function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onEsc);
    wrap.querySelector('.admin-modal__close').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });

    return { wrap: wrap, close: close };
  }

  function text(opts, cb) {
    opts = opts || {};
    var s = shell(
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
      '</div>',
      opts.title || '');

    var wrap = s.wrap;
    var input = wrap.querySelector('.ask-input');
    var warnEl = wrap.querySelector('.ask-warn');
    var okBtn = wrap.querySelector('[data-ok]');
    var warned = false;

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
      s.close();
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
    wrap.querySelector('[data-cancel]').onclick = s.close;
    input.focus();
  }

  function confirm(opts, cb, onCancel) {
    opts = opts || {};
    var okd = false;
    var s = shell(
      '<h3>' + esc(opts.title || 'Are you sure?') + '</h3>' +
      (opts.body ? '<p class="ask-body">' + bodyHtml(opts.body) + '</p>' : '') +
      '<div class="ask-actions">' +
        '<button class="btn btn--ghost" type="button" data-cancel>' + esc(opts.cancel || 'Cancel') + '</button>' +
        '<button class="btn ' + (opts.danger ? 'btn--danger' : 'btn--gold') + '" type="button" data-ok>' + esc(opts.ok || 'OK') + '</button>' +
      '</div>',
      opts.title || '',
      function () { if (!okd && onCancel) onCancel(); });   // onCancel: Esc / Cancel / backdrop dismissal
    s.wrap.querySelector('[data-cancel]').onclick = s.close;
    s.wrap.querySelector('[data-ok]').onclick = function () { okd = true; s.close(); if (cb) cb(); };
    // Destructive dialogs default-focus Cancel so a stray Enter never deletes.
    s.wrap.querySelector(opts.danger ? '[data-cancel]' : '[data-ok]').focus();
  }

  function alert(opts, cb) {
    opts = opts || {};
    var s = shell(
      '<h3>' + esc(opts.title || 'Notice') + '</h3>' +
      (opts.body ? '<p class="ask-body">' + bodyHtml(opts.body) + '</p>' : '') +
      '<div class="ask-actions">' +
        '<button class="btn btn--gold" type="button" data-ok>' + esc(opts.ok || 'OK') + '</button>' +
      '</div>',
      opts.title || '', cb);
    s.wrap.querySelector('[data-ok]').onclick = s.close;
    s.wrap.querySelector('[data-ok]').focus();
  }

  window.ZBXIAsk = { text: text, confirm: confirm, alert: alert };
})();
