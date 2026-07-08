/* Zeta Beta Xi — site interactions. Vanilla JS, no dependencies. */
(function () {
  'use strict';

  /* ---- Year ---- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  /* ---- Mobile nav ---- */
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
    });
  }

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

  /* ---- Gallery teaser: latest posts for approved brothers, CTA otherwise ---- */
  var teaser = document.getElementById('galleryTeaser');
  function teaserCta(msg) {
    teaser.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔒 <b>Brothers only</b>' +
      '<span>' + msg + '</span>' +
      '<a class="btn btn--gold" href="gallery.html">Open the gallery</a></div>';
  }
  if (teaser) {
    if (!(window.ZBXI && window.ZBXI.configured)) {
      teaserCta('The private gallery opens with the members area.');
    } else {
      window.ZBXI.amApprovedBrother().then(function (ok) {
        if (!ok) { teaserCta('Sign in as a verified brother to see photos shared by the brotherhood.'); return; }
        window.ZBXI.galleryList().then(function (posts) {
          posts = (posts || []).slice(0, 6);
          if (!posts.length) { teaserCta('No posts yet — be the first to share a memory.'); return; }
          var paths = posts.map(function (p) { return p.image_path; });
          window.ZBXI.gallerySignedUrls(paths).then(function (urls) {
            teaser.innerHTML = '<div class="gallery">' + posts.map(function (p) {
              var u = urls[p.image_path];
              return '<a href="gallery.html" aria-label="Open the gallery">' + (u ? '<img src="' + esc(u) + '" loading="lazy" alt="">' : '') + '</a>';
            }).join('') + '</div>' +
            '<p class="center" style="margin-top:1.6rem"><a class="btn btn--navy" href="gallery.html">Open the full gallery →</a></p>';
          });
        }).catch(function () { teaserCta('Sign in as a verified brother to see photos shared by the brotherhood.'); });
      });
    }
  }

  /* ---- Chapter calendar: members-only (DB-enforced), month grid + Up Next rail,
         admins add/edit events right on the calendar (Google-style) ---- */
  var calWrap = document.getElementById('calWrap');
  if (calWrap) {
    var CAT_LABEL = { rush: 'Rush', philanthropy: 'Philanthropy', reunion: 'Reunion', meeting: 'Chapter Meeting', social: 'Social' };
    var EV_CATS = ['social', 'meeting', 'philanthropy', 'rush', 'reunion'];
    var EV_ALL = [], IS_ADMIN = false, ME = null, selDay = null;
    var RSVPS = [], RSVP_DIR = {}, CAN_RSVP = false;
    var cal = (function () { var d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

    function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
    function evsOn(date) { return EV_ALL.filter(function (e) { return sameDay(new Date(e.starts_at), date); }); }
    function evEnd(e) { return e.ends_at ? new Date(e.ends_at) : new Date(new Date(e.starts_at).getTime() + 3 * 3600 * 1000); }
    function evTime(e) {
      if (e.all_day) return 'All day';
      var t = new Date(e.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      if (e.ends_at && sameDay(new Date(e.starts_at), new Date(e.ends_at))) {
        t += ' – ' + new Date(e.ends_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
      return t;
    }
    function evLoc(e) {
      if (!e.location) return '';
      return ' · <a class="ev-loc" target="_blank" rel="noopener" href="https://maps.google.com/?q=' +
        encodeURIComponent(e.location) + '">📍 ' + esc(e.location) + '</a>';
    }

    function lockedCal() {
      calWrap.innerHTML = '<div class="bm__locked" style="max-width:560px;margin:0 auto">🔒 <b>The chapter calendar is members-only</b>' +
        '<span>Meetings, reunions, rush and philanthropy — with RSVPs — open when you sign in as a verified brother.</span>' +
        '<a class="btn btn--gold" href="#brothers-portal">Brother sign in</a></div>';
    }

    /* -- RSVPs -- */
    function rsvpsFor(id) { return RSVPS.filter(function (r) { return r.event_id === id; }); }
    function iGo(id) { return ME && RSVPS.some(function (r) { return r.event_id === id && r.user_id === ME.id; }); }
    function rsvpBar(e) {
      if (!CAN_RSVP) return '';
      var rs = rsvpsFor(e.id);
      var names = rs.map(function (r) {
        var m = RSVP_DIR[r.user_id];
        return m ? m.full_name.split(' ')[0] : 'a brother';
      });
      var who = names.length ? '<small class="ev-rsvp__who">Going: ' + esc(names.slice(0, 6).join(', ')) + (names.length > 6 ? ' +' + (names.length - 6) : '') + '</small>' : '';
      return '<div class="ev-rsvp" data-rsvp="' + e.id + '">' +
        '<button class="ev-rsvp__btn' + (iGo(e.id) ? ' on' : '') + '">' + (iGo(e.id) ? '✓ I\'m going' : '✋ I\'m going') + '</button>' +
        '<b>' + rs.length + '</b> going' + who + '</div>';
    }
    function wireRsvps(scope) {
      scope.querySelectorAll('[data-rsvp]').forEach(function (bar) {
        var id = bar.dataset.rsvp;
        bar.querySelector('.ev-rsvp__btn').onclick = function () {
          if (!ME) return;
          var going = iGo(id);
          var op = going ? window.ZBXI.unrsvp(id, ME.id) : window.ZBXI.rsvp(id, ME.id);
          if (going) RSVPS = RSVPS.filter(function (r) { return !(r.event_id === id && r.user_id === ME.id); });
          else RSVPS.push({ event_id: id, user_id: ME.id });
          refresh();
          op.then(function (r) { if (r.error) window.ZBXI.rsvpList().then(function (l) { RSVPS = l; refresh(); }); });
        };
      });
    }

    /* -- layout: month grid + Up Next rail -- */
    function buildCalLayout() {
      calWrap.innerHTML = '<div class="cal-layout">' +
        '<div class="cal-main" id="calMain"></div>' +
        '<aside class="cal-rail" id="calRail"></aside>' +
      '</div>';
    }

    function renderMonth() {
      var main = document.getElementById('calMain');
      if (!main) return;
      var first = new Date(cal.y, cal.m, 1);
      var today = new Date();
      var startDow = (first.getDay() + 6) % 7; // Monday-first
      var daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
      var title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

      var head = '<div class="cal-head">' +
        '<button class="cal-nav" data-cal="-1" aria-label="Previous month">‹</button>' +
        '<b>' + title + '</b>' +
        '<button class="cal-nav" data-cal="1" aria-label="Next month">›</button></div>';

      var dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span class="cal-dow">' + d + '</span>'; }).join('');

      var cells = '';
      for (var i = 0; i < startDow; i++) cells += '<span class="cal-cell cal-cell--pad"></span>';
      for (var day = 1; day <= daysInMonth; day++) {
        var date = new Date(cal.y, cal.m, day);
        var evs = evsOn(date);
        var chips = evs.slice(0, 2).map(function (e) {
          return '<span class="cal-chip cal-chip--' + e.category + '">' + esc(e.title) + '</span>';
        }).join('') + (evs.length > 2 ? '<span class="cal-more">+' + (evs.length - 2) + '</span>' : '');
        var canClick = evs.length || IS_ADMIN;
        cells += '<button class="cal-cell' + (sameDay(date, today) ? ' cal-cell--today' : '') +
          (evs.length ? ' cal-cell--has' : '') + (selDay === day ? ' cal-cell--sel' : '') +
          '"' + (canClick ? ' data-day="' + day + '"' : ' disabled') + '>' +
          '<span class="cal-cell__n">' + day + '</span>' + chips + '</button>';
      }

      main.innerHTML = head + '<div class="cal-grid">' + dows + cells + '</div><div class="cal-detail" id="calDetail"></div>';

      main.querySelectorAll('[data-cal]').forEach(function (b) {
        b.onclick = function () {
          cal.m += parseInt(b.dataset.cal, 10);
          if (cal.m < 0) { cal.m = 11; cal.y--; }
          if (cal.m > 11) { cal.m = 0; cal.y++; }
          selDay = null;
          renderMonth();
        };
      });
      main.querySelectorAll('.cal-cell[data-day]').forEach(function (c) {
        c.onclick = function () { showDay(parseInt(c.dataset.day, 10), true); };
      });
      if (selDay != null) showDay(selDay, false);
    }

    function showDay(day, scroll) {
      var changed = selDay !== day;
      selDay = day;
      var date = new Date(cal.y, cal.m, day);
      var evs = evsOn(date);
      var box = document.getElementById('calDetail');
      if (!box) return;
      var html = '<h4>' + date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + '</h4>';
      html += evs.map(function (e) {
        return '<div class="cal-detail__ev"><span class="event__tag">' + (CAT_LABEL[e.category] || e.category) + '</span>' +
          '<b>' + esc(e.title) + '</b><small>' + evTime(e) + evLoc(e) + '</small>' +
          (e.description ? '<p>' + esc(e.description) + '</p>' : '') + rsvpBar(e) +
          (IS_ADMIN ? '<div class="cal-adminrow"><button class="cal-mini" data-ev-edit="' + e.id + '">✎ Edit</button><button class="cal-mini cal-mini--del" data-ev-del="' + e.id + '">🗑 Delete</button></div>' : '') +
        '</div>';
      }).join('');
      if (!evs.length && !IS_ADMIN) { box.innerHTML = ''; selDay = null; return; }
      if (!evs.length) html += '<p class="cal-detail__none">Nothing on this day yet.</p>';
      if (IS_ADMIN) html += '<button class="btn btn--gold cal-detail__add" data-ev-add>＋ Add event on this day</button>';
      box.innerHTML = html;
      wireRsvps(box);
      wireAdmin(box, date);
      if (changed && scroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // reflect selection ring without a full re-render
      document.querySelectorAll('#calMain .cal-cell--sel').forEach(function (c) { c.classList.remove('cal-cell--sel'); });
      var cell = document.querySelector('#calMain .cal-cell[data-day="' + day + '"]');
      if (cell) cell.classList.add('cal-cell--sel');
    }

    function renderRail() {
      var rail = document.getElementById('calRail');
      if (!rail) return;
      var upcoming = EV_ALL.filter(function (e) { return evEnd(e).getTime() > Date.now(); })
        .sort(function (a, z) { return new Date(a.starts_at) - new Date(z.starts_at); })
        .slice(0, 4);
      var html = '<h3 class="cal-rail__h">⚡ Up Next</h3>';
      if (!upcoming.length) {
        html += '<p class="cal-rail__none">No upcoming events yet' + (IS_ADMIN ? ' — add the first one below.' : ' — check back soon.') + '</p>';
      } else {
        html += upcoming.map(function (e) {
          var d = new Date(e.starts_at);
          return '<article class="unx" data-goto="' + e.starts_at + '">' +
            '<div class="unx__date"><b>' + d.getDate() + '</b><span>' + d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase() + '</span></div>' +
            '<div class="unx__body"><span class="unx__cat unx__cat--' + e.category + '">' + (CAT_LABEL[e.category] || e.category) + '</span>' +
            '<b>' + esc(e.title) + '</b><small>' + evTime(e) + evLoc(e) + '</small>' + rsvpBar(e) + '</div></article>';
        }).join('');
      }
      if (IS_ADMIN) html += '<button class="btn btn--gold cal-rail__add" data-ev-add-any>＋ Add an event</button>';
      html += '<button class="cal-rail__help" id="calHelpBtn">❓ How the calendar works</button>';
      rail.innerHTML = html;
      wireRsvps(rail);
      rail.querySelectorAll('.unx[data-goto]').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('.ev-rsvp') || e.target.closest('a')) return;
          var d = new Date(card.dataset.goto);
          cal.y = d.getFullYear(); cal.m = d.getMonth(); selDay = d.getDate();
          renderMonth();
          var main = document.getElementById('calMain');
          if (main) main.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });
      var addAny = rail.querySelector('[data-ev-add-any]');
      if (addAny) addAny.onclick = function () { openEvModal(null, new Date(cal.y, cal.m, selDay || new Date().getDate())); };
      var helpBtn = document.getElementById('calHelpBtn');
      if (helpBtn) helpBtn.onclick = openCalHelp;
    }

    function refresh() { renderRail(); if (selDay != null) showDay(selDay, false); }
    function reloadEvents() {
      window.ZBXI.eventsList().then(function (rows) {
        EV_ALL = rows || [];
        renderMonth(); renderRail();
      });
    }

    /* -- admin: add/edit right on the calendar -- */
    function wireAdmin(scope, date) {
      var add = scope.querySelector('[data-ev-add]');
      if (add) add.onclick = function () { openEvModal(null, date); };
      scope.querySelectorAll('[data-ev-edit]').forEach(function (b) {
        b.onclick = function () {
          var e = EV_ALL.filter(function (x) { return x.id === b.dataset.evEdit; })[0];
          if (e) openEvModal(e, null);
        };
      });
      scope.querySelectorAll('[data-ev-del]').forEach(function (b) {
        b.onclick = function () {
          var e = EV_ALL.filter(function (x) { return x.id === b.dataset.evDel; })[0];
          if (!e) return;
          if (!confirm('Delete "' + e.title + '"? This cannot be undone.')) return;
          window.ZBXI.eventDelete(e.id).then(reloadEvents);
        };
      });
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function openEvModal(ev, presetDate) {
      var m = document.getElementById('evModal');
      if (!m) { m = document.createElement('div'); m.id = 'evModal'; m.className = 'pmodal'; document.body.appendChild(m); }
      var e = ev || {};
      var sd = e.starts_at ? new Date(e.starts_at) : (presetDate || new Date());
      var ed = e.ends_at ? new Date(e.ends_at) : null;
      var dateVal = sd.getFullYear() + '-' + pad2(sd.getMonth() + 1) + '-' + pad2(sd.getDate());
      var startVal = e.starts_at && !e.all_day ? pad2(sd.getHours()) + ':' + pad2(sd.getMinutes()) : '';
      var endVal = ed && !e.all_day ? pad2(ed.getHours()) + ':' + pad2(ed.getMinutes()) : '';
      m.innerHTML = '<div class="pmodal__card card-form">' +
        '<button class="pmodal__close" data-ev-close aria-label="Close">✕</button>' +
        '<h3 style="color:var(--navy);font-family:var(--display);margin-top:0">' + (ev ? 'Edit event' : 'Add event') + '</h3>' +
        '<div class="field"><label>Title *</label><input id="evmTitle" value="' + esc(e.title || '') + '" /></div>' +
        '<label class="evm-allday"><input type="checkbox" id="evmAllDay"' + (e.all_day ? ' checked' : '') + ' /> All-day event</label>' +
        '<div class="field"><label>Date *</label><input id="evmDate" type="date" value="' + dateVal + '" /></div>' +
        '<div class="evm-times" id="evmTimes"' + (e.all_day ? ' style="display:none"' : '') + '>' +
          '<div class="field"><label>Starts</label><input id="evmStart" type="time" value="' + startVal + '" /></div>' +
          '<div class="field"><label>Ends (optional)</label><input id="evmEnd" type="time" value="' + endVal + '" /></div>' +
        '</div>' +
        '<div class="field"><label>Location (optional — becomes a map link)</label><input id="evmLoc" value="' + esc(e.location || '') + '" placeholder="e.g. MacVittie Union, Geneseo" /></div>' +
        '<div class="field"><label>Category</label><select id="evmCat">' + EV_CATS.map(function (c) {
          return '<option value="' + c + '"' + (e.category === c ? ' selected' : '') + '>' + (CAT_LABEL[c] || c) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field"><label>Description (optional)</label><textarea id="evmDesc">' + esc(e.description || '') + '</textarea></div>' +
        '<div class="evm-actions">' +
          '<button class="btn btn--navy" id="evmSave">' + (ev ? 'Save changes' : 'Add to calendar') + '</button>' +
          (ev ? '<button class="cal-mini cal-mini--del" id="evmDel">🗑 Delete</button>' : '') +
        '</div>' +
        '<p class="form-status" id="evmStatus"></p>' +
      '</div>';
      m.classList.add('open');
      m.setAttribute('aria-hidden', 'false');
      function close() { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
      m.querySelector('[data-ev-close]').onclick = close;
      m.addEventListener('click', function (x) { if (x.target === m) close(); });
      var allday = m.querySelector('#evmAllDay');
      allday.onchange = function () { m.querySelector('#evmTimes').style.display = allday.checked ? 'none' : ''; };
      m.querySelector('#evmSave').onclick = function () {
        var st = m.querySelector('#evmStatus');
        var title = m.querySelector('#evmTitle').value.trim();
        var dv = m.querySelector('#evmDate').value;
        if (!title || !dv) { st.className = 'form-status err'; st.textContent = 'A title and a date are required.'; return; }
        var isAll = allday.checked;
        var t1 = m.querySelector('#evmStart').value || '12:00';
        var t2 = m.querySelector('#evmEnd').value;
        var row = {
          title: title,
          all_day: isAll,
          starts_at: new Date(dv + 'T' + (isAll ? '00:00' : t1)).toISOString(),
          ends_at: (!isAll && t2) ? new Date(dv + 'T' + t2).toISOString() : null,
          location: m.querySelector('#evmLoc').value.trim() || null,
          category: m.querySelector('#evmCat').value,
          description: m.querySelector('#evmDesc').value.trim() || null
        };
        st.className = 'form-status'; st.textContent = 'Saving…';
        var op = ev ? window.ZBXI.eventUpdate(ev.id, row) : window.ZBXI.eventCreate(row);
        op.then(function (r) {
          if (r && r.error) { st.className = 'form-status err'; st.textContent = r.error.message; return; }
          close(); reloadEvents();
        });
      };
      var del = m.querySelector('#evmDel');
      if (del) del.onclick = function () {
        if (!confirm('Delete "' + ev.title + '"? This cannot be undone.')) return;
        window.ZBXI.eventDelete(ev.id).then(function () { close(); reloadEvents(); });
      };
    }

    /* -- plain-English brief -- */
    function openCalHelp() {
      var m = document.getElementById('calHelpModal');
      if (!m) { m = document.createElement('div'); m.id = 'calHelpModal'; m.className = 'pmodal'; document.body.appendChild(m); }
      m.innerHTML = '<div class="pmodal__card card-form">' +
        '<button class="pmodal__close" data-hc aria-label="Close">✕</button>' +
        '<h3 style="color:var(--navy);font-family:var(--display);margin-top:0">How the calendar works</h3>' +
        '<div class="cal-helpbody">' +
        '<p><b>📅 Reading it.</b> Days with a colored chip have something happening. Click the day to see the details — time, place, and what it is. The colors are just categories (gold = social, green = philanthropy, and so on).</p>' +
        '<p><b>✋ RSVP.</b> Press “I\'m going” on any event so the chapter knows to expect you. Press it again to change your mind — no harm done.</p>' +
        '<p><b>📍 Getting there.</b> If an event shows a location, clicking it opens the map.</p>' +
        '<p><b>⚡ Up Next.</b> The list beside the calendar always shows the next few events, so you never have to hunt for them.</p>' +
        (IS_ADMIN ? '<p><b>⚙ Webmaster only.</b> Click any day and press “＋ Add event on this day” — fill in the title and time and it\'s live for every brother instantly. Use ✎ Edit or 🗑 Delete on an event to change it. No code, ever.</p>' : '') +
        '</div></div>';
      m.classList.add('open');
      m.setAttribute('aria-hidden', 'false');
      m.querySelector('[data-hc]').onclick = function () { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); };
      m.addEventListener('click', function (x) { if (x.target === m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); } });
    }

    /* -- boot -- */
    if (!(window.ZBXI && window.ZBXI.configured)) {
      lockedCal();
    } else {
      window.ZBXI.amApprovedBrother().then(function (ok) {
        if (!ok) { lockedCal(); return; }
        Promise.all([window.ZBXI.getUser(), window.ZBXI.eventsList(), window.ZBXI.rsvpList(), window.ZBXI.memberDirectory()]).then(function (res) {
          ME = res[0];
          EV_ALL = res[1] || [];
          RSVPS = res[2] || [];
          RSVP_DIR = res[3] || {};
          CAN_RSVP = true;
          IS_ADMIN = !!(ME && ME.email && window.ZBXI.adminEmail && ME.email.toLowerCase() === window.ZBXI.adminEmail);
          buildCalLayout();
          renderMonth();
          renderRail();
        }).catch(function () { calWrap.innerHTML = '<p class="page-empty">Could not load the calendar — try refreshing.</p>'; });
      }).catch(lockedCal);
    }
  }

  /* ---- Brother of the Month (deterministic monthly rotation) ---- */
  var spotSec = document.getElementById('spotlight');
  var spotEl = document.getElementById('spotlightCard');
  if (spotSec && spotEl && window.ZBXI && window.ZBXI.configured) {
    var monthKey = new Date().getFullYear() + '-' + (new Date().getMonth() + 1);
    var hash = 0;
    for (var hi = 0; hi < monthKey.length; hi++) hash = (hash * 31 + monthKey.charCodeAt(hi)) >>> 0;

    window.ZBXI.amApprovedBrother().then(function (ok) {
      if (ok) {
        window.ZBXI.listVerifiedDetail().then(function (rows) {
          var cands = (rows || []).filter(function (b) { return b.user_id && b.photo_url && b.bio; })
            .sort(function (a, z) { return a.full_name.localeCompare(z.full_name); });
          if (!cands.length) return; // section stays hidden until profiles are complete
          var b = cands[hash % cands.length];
          spotSec.style.display = '';
          var sub = [b.pledge_class, b.grad_year ? 'Class of ' + b.grad_year : null,
                     [b.occupation, b.city].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
          var excerpt = b.bio.length > 260 ? b.bio.slice(0, 260).replace(/\s+\S*$/, '') + '…' : b.bio;
          spotEl.innerHTML =
            '<div class="spot-card">' +
              '<img class="spot-card__photo" src="' + esc(b.photo_url) + '" alt="">' +
              '<div class="spot-card__body">' +
                '<h3>' + esc(b.full_name) + '</h3>' +
                '<p class="spot-card__sub">' + esc(sub) + '</p>' +
                (b.quote ? '<p class="spot-card__quote">“' + esc(b.quote) + '”</p>' : '') +
                '<p class="spot-card__bio">' + esc(excerpt) + '</p>' +
                '<button class="btn btn--navy" id="spotMore">Read his full profile →</button>' +
              '</div></div>';
          var more = document.getElementById('spotMore');
          if (more) more.onclick = function () {
            if (window.BrotherCard) window.BrotherCard.open({ id: b.id, full_name: b.full_name, pledge_class: b.pledge_class, role: b.role, role_term: b.role_term, photo_url: b.photo_url, registered: true }, { portal: '#brothers-portal' });
          };
        });
      } else {
        // Public teaser (names/details are members-only now)
        spotSec.style.display = '';
        spotEl.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🏅 <b>This month\'s featured brother</b>' +
          '<span>Every month we spotlight one brother\'s story — where the brotherhood took him. Sign in to read it.</span>' +
          '<a class="btn btn--gold" href="#brothers-portal">Brother sign in</a></div>';
      }
    });
  }

  /* ---- Greek Excellence awards (admin-editable; static markup is the fallback) ---- */
  var awardsGrid = document.getElementById('awardsGrid');
  if (awardsGrid && window.ZBXI && window.ZBXI.configured) {
    var PILLAR_IC = { community: '★', service: '✚', leadership: '♛', responsibility: '⚖', other: '◆' };
    window.ZBXI.awardsList().then(function (rows) {
      if (!rows || !rows.length) return; // keep the hard-coded four
      var years = [];
      rows.forEach(function (a) { if (years.indexOf(a.year_label) === -1) years.push(a.year_label); });
      var title = document.getElementById('awardsTitle');
      var yearsEl = document.getElementById('awardYears');

      function showYear(y) {
        if (title) title.textContent = y + ' Greek Excellence Awards';
        awardsGrid.innerHTML = rows.filter(function (a) { return a.year_label === y; }).map(function (a) {
          return '<div class="medal">' +
            '<div class="medal__seal"><span>' + (PILLAR_IC[a.pillar] || '◆') + '</span></div>' +
            '<b>' + esc(a.title) + '</b>' +
            '<span class="medal__pillar">' + esc(a.pillar === 'other' ? 'Excellence' : a.pillar.charAt(0).toUpperCase() + a.pillar.slice(1)) + '</span>' +
            (a.note ? '<p>' + esc(a.note) + '</p>' : '') +
          '</div>';
        }).join('');
        if (yearsEl) yearsEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.y === y); });
      }

      if (yearsEl && years.length > 1) {
        yearsEl.style.display = '';
        yearsEl.innerHTML = years.map(function (y) {
          return '<button data-y="' + esc(y) + '">' + esc(y) + '</button>';
        }).join('');
        yearsEl.querySelectorAll('button').forEach(function (b) {
          b.onclick = function () { showYear(b.dataset.y); };
        });
      }
      showYear(years[0]);
    }).catch(function () {}); // fallback markup stands
  }

  /* ---- Giving campaigns (links from config.js DONATION_LINKS) ---- */
  var giveEl = document.getElementById('giveGrid');
  if (giveEl) {
    var LINKS = (window.ZBXI_CONFIG && window.ZBXI_CONFIG.DONATION_LINKS) || {};
    var CAMPAIGNS = [
      { key: 'annual_fund', icon: '🏛️', title: 'Annual Brotherhood Fund', blurb: 'Keeps the chapter running — rush, brotherhood events and day-to-day operations.' },
      { key: 'scholarship', icon: '🎓', title: 'Scholarship & Academics', blurb: 'Supports active brothers with books, fees and academic awards.' },
      { key: 'philanthropy', icon: '🤝', title: 'Philanthropy Drives', blurb: 'Fuels our service work in the Geneseo community and beyond.' }
    ];
    giveEl.innerHTML = CAMPAIGNS.map(function (c) {
      var url = LINKS[c.key];
      return '<div class="give-tile">' +
        '<span class="give-tile__ic">' + c.icon + '</span>' +
        '<h4>' + c.title + '</h4><p>' + c.blurb + '</p>' +
        (url ? '<a class="btn btn--gold" href="' + esc(url) + '" target="_blank" rel="noopener">Give now</a>'
             : '<span class="give-tile__soon">Online giving coming soon</span>') +
      '</div>';
    }).join('');
  }

  /* ---- Forms (Formspree). Graceful AJAX submit + inline status. ---- */
  function wireForm(formId, statusId) {
    var form = document.getElementById(formId);
    var status = document.getElementById(statusId);
    if (!form || !status) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = '';

      // Native validation
      if (!form.checkValidity()) { form.reportValidity(); return; }

      // Not configured yet? Tell the user honestly instead of failing silently.
      if (form.action.indexOf('YOUR_FORM_ID') !== -1) {
        status.className = 'form-status err';
        status.textContent = 'Form not connected yet — add your Formspree ID (see README). Your message was not sent.';
        return;
      }

      var btn = form.querySelector('button[type=submit]');
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } })
        .then(function (r) {
          if (r.ok) {
            form.reset();
            status.className = 'form-status ok';
            status.textContent = '✓ Thank you! We’ll be in touch soon.';
          } else {
            return r.json().then(function (d) {
              throw new Error(d && d.errors ? d.errors.map(function (x) { return x.message; }).join(', ') : 'submission failed');
            });
          }
        })
        .catch(function () {
          status.className = 'form-status err';
          status.textContent = 'Something went wrong. Please email us directly or try again.';
        })
        .finally(function () { if (btn) { btn.disabled = false; btn.textContent = label; } });
    });
  }
  wireForm('contactForm', 'contactStatus');

  /* ---- Brotherhood directory counts (Active / Alumni link cards) ---- */
  var caEl = document.getElementById('countActive');
  var clEl = document.getElementById('countAlumni');
  if (caEl && clEl && window.ZBXI && window.ZBXI.configured) {
    var now = new Date();
    var CUTOFF = now.getFullYear() + (now.getMonth() >= 5 ? 1 : 0);
    var pledgeYear = function (cls) {
      if (!cls) return null;
      var m4 = cls.match(/(19|20)\d{2}/); if (m4) return parseInt(m4[0], 10);
      var m2 = cls.match(/'(\d{2})/); if (!m2) return null;
      var yy = parseInt(m2[1], 10); return yy >= 93 ? 1900 + yy : 2000 + yy;
    };
    window.ZBXI.listFamilyPublic().then(function (rows) {
      if (!rows || !rows.length) { caEl.textContent = '🔒 members'; clEl.textContent = '🔒 members'; return; }
      var active = rows.filter(function (b) {
        var grad = (b.registered && b.grad_year) ? b.grad_year
                 : (b.grad_year || (pledgeYear(b.pledge_class) != null ? pledgeYear(b.pledge_class) + 4 : null));
        return grad != null && grad >= CUTOFF;
      }).length;
      caEl.textContent = active + ' brothers';
      clEl.textContent = (rows.length - active) + ' brothers';
    }).catch(function () { caEl.textContent = '🔒 members'; clEl.textContent = '🔒 members'; });
  }
})();
