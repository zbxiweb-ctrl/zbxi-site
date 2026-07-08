/* Pledge-class reunion page (class.html?c=<pledge class>). Shows the class
   roster (photos for approved members), stats, and a class-thread button that
   deep-links into the Board. Reuses BrotherCard for the gated modal. */
(function () {
  'use strict';
  var grid = document.getElementById('classGrid');
  if (!grid) return;
  var Z = window.ZBXI;

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

  var cls = new URLSearchParams(location.search).get('c') || '';
  var titleEl = document.getElementById('classTitle');
  var statsEl = document.getElementById('classStats');
  var threadBtn = document.getElementById('classThreadBtn');

  if (!cls || !Z || !Z.configured) {
    grid.innerHTML = '<p class="page-empty">No pledge class specified. Open a brother\'s card and tap his class.</p>';
    return;
  }

  titleEl.textContent = cls;
  document.title = cls + ' · Zeta Beta Xi';

  var LIST = [];
  function card(b) {
    var reg = b.registered;
    var av = b.photo_url ? '<img src="' + esc(b.photo_url) + '" alt="">' :
      esc((window.BrotherCard ? window.BrotherCard.initials(b.full_name) : 'ΖΒΞ'));
    return '<button class="bro-card' + (reg ? ' bro-card--live' : '') + '" data-id="' + b.id + '">' +
      '<span class="bro-card__av">' + av + (reg ? '<i class="bro-card__dot"></i>' : '') + '</span>' +
      '<span class="bro-card__meta"><b>' + esc(b.full_name) + '</b>' +
        '<small>' + (b.grad_year ? 'Class of ' + esc(b.grad_year) : esc(cls)) + '</small>' +
        (reg ? '<em class="bro-card__tag">● on the site</em>' : '<em class="bro-card__tag bro-card__tag--off">unclaimed</em>') +
      '</span></button>';
  }

  function render() {
    grid.innerHTML = LIST.length ? LIST.map(card).join('')
      : '<p class="page-empty">No brothers found for “' + esc(cls) + '”.</p>';
    grid.querySelectorAll('[data-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var b = LIST.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (b && window.BrotherCard) window.BrotherCard.open(b, { portal: 'index.html#brothers-portal' });
      });
    });
  }

  Z.listFamilyPublic().then(function (rows) {
    LIST = (rows || []).filter(function (b) { return (b.pledge_class || '') === cls; })
      .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });
    var grads = LIST.map(function (b) { return b.grad_year; }).filter(Boolean);
    statsEl.textContent = LIST.length + ' brothers crossed in this class' +
      (grads.length ? ' · grads ' + Math.min.apply(null, grads) + '–' + Math.max.apply(null, grads) : '') + '.';
    render();

    // members get photos + the class thread button
    Z.amApprovedBrother().then(function (ok) {
      if (!ok) return;
      threadBtn.style.display = '';
      threadBtn.href = 'board.html#compose=' + encodeURIComponent('[' + cls + '] Class thread');
      Z.listVerifiedDetail().then(function (det) {
        var byId = {};
        (det || []).forEach(function (d) { byId[d.id] = d; });
        LIST.forEach(function (b) {
          var d = byId[b.id];
          if (d) { b.photo_url = d.photo_url; b.grad_year = d.grad_year || b.grad_year; }
        });
        render();
      });
    });
  }).catch(function () {
    grid.innerHTML = '<p class="page-empty">Could not load the class. Try refreshing.</p>';
  });
})();
