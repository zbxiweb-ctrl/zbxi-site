/* Shared brother profile-card renderer. One source of truth so the family
   tree, active/alumni pages and gallery/board show identical profile data.
   Exposes window.BrotherCard. Requires the #brotherModal markup + ZBXI. */
(function () {
  'use strict';

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }
  function row(k, v) { return v ? '<div class="bm__row"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; }
  function initials(name) {
    return String(name || '').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean)
      .slice(-2).map(function (s) { return s[0]; }).join('').toUpperCase() || 'ΖΒΞ';
  }

  // "President · Fall 2019" from role + role_term
  function titleOf(b) {
    if (!b || !b.role) return '';
    return b.role + (b.role_term ? ' · ' + b.role_term : '');
  }

  // "Open to" badges — the networking flags brothers set on their profile.
  var OPEN_LABEL = { mentor: '🎓 Open to mentoring', hire: '💼 Hiring & referrals', connect: '🤝 Open to connecting' };
  function openChips(d) {
    var chips = (d.open_to || []).filter(function (k) { return OPEN_LABEL[k]; })
      .map(function (k) { return '<span class="ot-chip">' + OPEN_LABEL[k] + '</span>'; }).join('');
    return chips ? '<div class="ot-chips">' + chips + '</div>' : '';
  }

  // The detail body for an APPROVED viewer, given the full brothers row.
  function detailHtml(d) {
    var prefs = String(d.contact_prefs || '').split(',');
    var contact = '';
    if (prefs.indexOf('email') !== -1 && d.email)
      contact += '<div class="bm__row"><span>Email</span><b><a href="mailto:' + esc(d.email) + '">' + esc(d.email) + '</a></b></div>';
    if (prefs.indexOf('phone') !== -1 && d.phone)
      contact += row('Phone', d.phone);
    if ((prefs.indexOf('linkedin') !== -1 || !d.contact_prefs) && d.linkedin)
      contact += '<div class="bm__row"><span>LinkedIn</span><b><a href="' + esc(d.linkedin) + '" target="_blank" rel="noopener">profile ↗</a></b></div>';

    return openChips(d) +
      row('Title', titleOf(d)) +
      row('Major', d.major) +
      row('Class of', d.grad_year) +
      row('Occupation', d.occupation) +
      row('Company', d.company) +
      row('Industry', d.industry) +
      row('Currently in', d.city) +
      row('Hometown', d.hometown) +
      row('Skills & interests', d.skills) +
      contact +
      (d.bio ? '<p class="bm__bio">' + esc(d.bio) + '</p>' : '') +
      (d.quote ? '<p class="bm__quote">“' + esc(d.quote) + '”</p>' : '');
  }

  /* Open the shared modal for brother b (a family_public row or richer).
     opts: { lineage: html prefix, portal: href to the login portal,
             placeholderData: row (render details directly, no gating) } */
  function open(b, opts) {
    opts = opts || {};
    var m = document.getElementById('brotherModal');
    if (!m || !b) return;
    m.querySelector('[data-f=name]').textContent = b.full_name;
    // The pledge class links to that class's reunion page.
    var subBits = [];
    if (b.pledge_class) subBits.push('<a class="bm-class" href="class.html?c=' + encodeURIComponent(b.pledge_class) + '">' + esc(b.pledge_class) + '</a>');
    if (titleOf(b)) subBits.push(esc(titleOf(b)));
    m.querySelector('[data-f=sub]').innerHTML = subBits.join(' · ');
    var av = m.querySelector('[data-f=avatar]');
    av.innerHTML = ''; av.textContent = initials(b.full_name);
    if (b.photo_url) av.innerHTML = '<img src="' + esc(b.photo_url) + '" alt="">';
    var body = m.querySelector('[data-f=body]');
    var lineage = opts.lineage || '';
    var portal = opts.portal || '#brothers-portal';
    m.classList.add('open'); m.setAttribute('aria-hidden', 'false');

    if (opts.placeholderData) { // demo mode: show what we have, ungated
      var d = opts.placeholderData;
      body.innerHTML = row('Major', d.major) + row('Class of', d.grad_year) + row('Hometown', d.hometown) +
        lineage + (d.quote ? '<p class="bm__quote">“' + esc(d.quote) + '”</p>' : '');
      return;
    }

    if (!b.registered) {
      body.innerHTML = lineage +
        '<div class="bm__locked">🌳 <b>Profile unclaimed</b><span>Is this you? Sign in and claim your name to bring this profile to life.</span>' +
        '<a class="btn btn--gold" href="' + portal + '" data-close>Claim your profile</a></div>';
      return;
    }

    body.innerHTML = lineage + '<p class="bm__loading">…</p>';
    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (!ok) {
        body.innerHTML = lineage +
          '<div class="bm__locked">🔒 <b>Members only</b><span>Sign in as a verified brother to view the full profile.</span>' +
          '<a class="btn btn--gold" href="' + portal + '" data-close>Log In / Sign Up</a></div>';
        return;
      }
      window.ZBXI.brotherDetail(b.id).then(function (d) {
        d = d || {};
        body.innerHTML = lineage + detailHtml(d);
        var dBits = [];
        if (d.pledge_class) dBits.push('<a class="bm-class" href="class.html?c=' + encodeURIComponent(d.pledge_class) + '">' + esc(d.pledge_class) + '</a>');
        if (titleOf(d)) dBits.push(esc(titleOf(d)));
        m.querySelector('[data-f=sub]').innerHTML = dBits.join(' · ');
        if (d.photo_url) av.innerHTML = '<img src="' + esc(d.photo_url) + '" alt="">';

        // Connect: any registered brother except yourself. Sends an intro
        // request (his 🔔 gets your name + email so he can simply reply).
        if (d.user_id && window.ZBXI.connectRequest) {
          window.ZBXI.getUser().then(function (me) {
            if (!me || me.id === d.user_id) return;
            var bar = document.createElement('div');
            bar.className = 'bm__connect';
            bar.innerHTML = '<button type="button" class="btn btn--gold bm__connect-btn">🤝 Connect</button>' +
              '<span>Sends your name &amp; email to his notifications so he can reply directly.</span>';
            body.appendChild(bar);
            var cbtn = bar.querySelector('button');
            cbtn.onclick = function () {
              cbtn.disabled = true; cbtn.textContent = 'Sending…';
              window.ZBXI.connectRequest(d.user_id).then(function (res) {
                cbtn.textContent = res === 'already' ? '✓ Already requested this week' : '✓ Request sent';
              }).catch(function () {
                cbtn.disabled = false; cbtn.textContent = '🤝 Connect';
              });
            };
          });
        }
      }).catch(function () { body.innerHTML = lineage + '<p class="bm__loading">Could not load details.</p>'; });
    });
  }

  // Wire close behavior once per page.
  var modal = document.getElementById('brotherModal');
  if (modal && !modal.dataset.wired) {
    modal.dataset.wired = '1';
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-close]')) {
        modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
    });
  }

  window.BrotherCard = { open: open, initials: initials, titleOf: titleOf, esc: esc };
})();
