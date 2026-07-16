/* Chapter events calendar — members-only (DB-enforced), month grid + Up Next rail,
   admins add/edit events right on the calendar (Google-style). Extracted from main.js
   so it can drive the standalone Events page. Self-inits on #calWrap. */
(function () {
  'use strict';

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }

  var calWrap = document.getElementById('calWrap');
  if (!calWrap) return;

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
      '<a class="btn btn--gold" href="index.html#brothers-portal">Log In / Sign Up</a></div>';
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
          '<div class="unx__body"><span class="unx__cat unx__cat--' + esc(e.category) + '">' + (CAT_LABEL[e.category] || esc(e.category)) + '</span>' +
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
})();
