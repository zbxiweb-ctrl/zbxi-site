/* The Alumni Fund — one page with one job: a brother decides to give, and gives.
   Everything here is in service of that or it should not be here.

   THE CASE SITS BESIDE THE ACTION. A bare payment link asks for money without
   saying why; the "what your gift supports" column is not decoration, it is the
   reason someone taps the button. On a phone the two stack, purpose first.

   THE NAME UNDER THE HANDLE IS THE TRUST ANCHOR. A brother asked to send money
   to a Venmo handle needs to know whose it is — linking it to the roster profile
   turns "is this real?" into "oh, that's Joe."

   NO QR CODE, deliberately. The handle is admin-editable, so a QR would have to be
   generated from the live value on every render — a JS dependency — and the
   alternative of committing a pre-made image is worse than useless: change the
   handle and the QR silently keeps pointing at the PREVIOUS president's Venmo. A
   stale payment target is the one bug this page must not have. Tap-to-open plus
   copy-to-clipboard covers the desktop case without it. */
(function () {
  'use strict';
  var root = document.getElementById('giveRoot');
  if (!root) return;
  var Z = window.ZBXI;

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Venmo handles are letters, digits, dashes and underscores. Stripping anything
  // else means a handle typed with a stray @ or a pasted full URL still produces a
  // working link instead of a 404 the admin would only discover from a brother.
  function cleanHandle(h) {
    return String(h || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_-]/g, '');
  }
  function venmoUrl(h) { return 'https://venmo.com/u/' + encodeURIComponent(cleanHandle(h)); }

  function lockedOut() {
    root.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Members only</b>' +
      '<span>The alumni fund is private to the brotherhood. Sign in to contribute.</span>' +
      '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a></div>';
  }

  function notReady() {
    root.innerHTML = '<div class="give-soon"><p class="eyebrow">Coming soon</p>' +
      '<p class="lede">The alumni fund is being set up. Check back shortly — ' +
      'or speak to the alumni president if you would like to contribute now.</p></div>';
  }

  function render(d, roster) {
    var handle = cleanHandle(d.handle);
    var supports = (d.supports || []).filter(function (s) { return String(s || '').trim(); });
    var bro = d.brother_id && roster ? roster.filter(function (b) { return b.id === d.brother_id; })[0] : null;
    var who = d.display_name || (bro && bro.full_name) || '';

    root.innerHTML =
      (d.blurb ? '<p class="lede give-blurb">' + esc(d.blurb) + '</p>' : '') +
      '<div class="give">' +

        (supports.length
          ? '<section class="give-case"><h2 class="give-h">What your gift supports</h2>' +
            '<ul class="give-list">' +
              supports.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
            '</ul></section>'
          : '') +

        '<section class="give-card' + (supports.length ? '' : ' give-card--solo') + '">' +
          '<h2 class="give-h">Send to the fund</h2>' +
          // The button is the page. Everything else is context for this tap.
          '<a class="give-btn" href="' + esc(venmoUrl(handle)) + '" target="_blank" rel="noopener noreferrer">' +
            '<span class="give-btn__at">@</span>' + esc(handle) +
          '</a>' +
          '<button type="button" class="give-copy" data-copy="' + esc(handle) + '">Copy the handle</button>' +
          (who
            ? '<p class="give-who">' +
                (bro ? '<button type="button" class="give-who__link" data-bro="' + esc(bro.id) + '">' + esc(who) + '</button>'
                     : esc(who)) +
                '<small>Alumni President · this is his Venmo</small></p>'
            : '') +
        '</section>' +
      '</div>';

    var copy = root.querySelector('[data-copy]');
    if (copy) copy.onclick = function () {
      var h = copy.dataset.copy;
      var done = function () {
        copy.textContent = 'Copied ✓';
        setTimeout(function () { copy.textContent = 'Copy the handle'; }, 1800);
      };
      // navigator.clipboard needs a secure context and can be refused; the textarea
      // fallback is what makes this work on an older phone browser rather than
      // silently doing nothing when a brother taps it.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(h).then(done)['catch'](function () { fallback(h, done); });
      } else { fallback(h, done); }
    };
    function fallback(text, done) {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', '');
      t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* nothing to do */ }
      t.remove();
    }

    var link = root.querySelector('[data-bro]');
    if (link) link.onclick = function () {
      var b = (roster || []).filter(function (x) { return x.id === link.dataset.bro; })[0];
      if (b && window.BrotherCard) window.BrotherCard.open(b, { portal: 'index.html#brothers-portal' });
    };
  }

  if (!Z || !Z.configured) {
    root.innerHTML = '<p class="page-empty">Members area is being set up — check back soon.</p>';
    return;
  }

  Z.amApprovedBrother().then(function (ok) {
    if (!ok) return lockedOut();
    return Z.donationsGet().then(function (d) {
      // No row means RLS refused us, not that the fund is unset.
      if (!d) return lockedOut();
      if (!d.active || !cleanHandle(d.handle)) return notReady();
      // The roster is only needed to make the president's name clickable, so a
      // failure there must not stop a brother from being able to give.
      return Z.listFamilyPublic()
        .then(function (rows) { render(d, rows || []); })
        ['catch'](function () { render(d, []); });
    });
  })['catch'](function () { lockedOut(); });
})();
