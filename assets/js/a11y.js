/* Site-wide accessibility layer — loaded on every page. Centralises the two
   systemic fixes from the 2026-07-18 review so we don't have to edit ~60 form
   sites and 10 modal implementations by hand:

   1. LABEL ASSOCIATION — most fields are emitted as `<div class="field">
      <label>X</label><input></div>` with no for/id, so screen readers announce
      "edit text, blank". We link each orphan <label> to its control after every
      render (initial load + a MutationObserver for JS-rendered forms).

   2. MODAL FOCUS MANAGEMENT — no modal moved focus in on open, trapped Tab, or
      restored focus on close. We do it generically by watching for any modal
      that becomes open+visible: move focus inside, loop Tab within it, and
      restore focus to the opener on close. We deliberately do NOT touch Escape
      handling (some modals intentionally block it, e.g. password recovery).

   3. SKIP LINK + MAIN — inject a "Skip to content" link targeting the page's
      <main>, so keyboard users bypass the nav on every page.

   Pure progressive enhancement: only adds attributes / focus behaviour, never
   changes layout or a control's own logic. */
(function () {
  'use strict';
  var uid = 0;

  /* ---- 1 · associate orphan <label>s with their control ---- */
  function associateLabels(root) {
    if (!root || !root.querySelectorAll) return;
    var labels = root.querySelectorAll('label:not([for])');
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      // A label that WRAPS its control (implicit association, e.g. .pref-box
      // checkboxes) is already fine — skip it.
      if (label.querySelector('input, select, textarea')) continue;
      // Find the control: the first form control in the same parent (label
      // comes first in the house `.field` pattern), else the next sibling.
      var ctrl = null;
      if (label.parentElement) ctrl = label.parentElement.querySelector('input, select, textarea');
      if (!ctrl) {
        var n = label.nextElementSibling;
        if (n && /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)) ctrl = n;
      }
      if (!ctrl) continue;
      if (!ctrl.id) ctrl.id = 'a11y-f-' + (++uid);
      label.setAttribute('for', ctrl.id);
    }
  }

  /* ---- 2 · modal focus management ---- */
  var MODAL_SEL = '.pmodal, .bmodal, .gmodal, .admin-modal';
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var active = null;   // { el, opener, onKey }

  function isOpen(el) {
    // Open = flagged open AND actually visible (guards against trapping a
    // hidden element that merely carries aria-hidden="false").
    if (!(el.classList.contains('open') || el.getAttribute('aria-hidden') === 'false')) return false;
    return el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
  }

  function focusableIn(el) {
    return Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), function (n) {
      return n.offsetParent !== null || getComputedStyle(n).position === 'fixed';
    });
  }

  function activate(el) {
    var opener = document.activeElement;
    if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    // Prefer the first form field, else the close button, else first focusable.
    var items = focusableIn(el);
    var target = el.querySelector('input:not([type="hidden"]), select, textarea')
      || el.querySelector('[data-x], [data-close], [data-nh], [data-mr], [data-pm-close], .admin-modal__close, .pmodal__close, .bmodal__close, .gmodal__close, .postModal__close')
      || items[0];
    if (target) { try { target.focus(); } catch (e) {} }

    function onKey(e) {
      if (e.key !== 'Tab') return;
      var f = focusableIn(el);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      else if (!el.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
    }
    el.addEventListener('keydown', onKey);
    active = { el: el, opener: opener, onKey: onKey };
  }

  function deactivate() {
    if (!active) return;
    active.el.removeEventListener('keydown', active.onKey);
    var o = active.opener;
    active = null;
    if (o && document.contains(o) && o.offsetParent !== null) { try { o.focus(); } catch (e) {} }
  }

  function reconcileModals() {
    var open = Array.prototype.filter.call(document.querySelectorAll(MODAL_SEL), isOpen);
    var top = open.length ? open[open.length - 1] : null;
    if (active && active.el === top) return;       // no change
    if (active && (!top || !document.contains(active.el) || !isOpen(active.el))) deactivate();
    if (top && (!active || active.el !== top)) activate(top);
  }

  /* ---- 3 · skip link + main landmark ---- */
  function installSkipLink() {
    var main = document.querySelector('main');
    if (!main) return;
    if (!main.id) main.id = 'main';
    if (main.getAttribute('tabindex') === null) main.setAttribute('tabindex', '-1');
    if (document.querySelector('.skip-link')) return;
    var a = document.createElement('a');
    a.className = 'skip-link';
    a.href = '#' + main.id;
    a.textContent = 'Skip to content';
    document.body.insertBefore(a, document.body.firstChild);
  }

  /* ---- wire it up ---- */
  function init() {
    installSkipLink();
    associateLabels(document);
    reconcileModals();
    var obs = new MutationObserver(function (muts) {
      var reLabel = false;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList' && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1) { associateLabels(node); reLabel = true; }
          }
        }
      }
      reconcileModals();
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
