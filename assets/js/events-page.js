/* Chapter events calendar — members-only (DB-enforced), month grid + Up Next rail,
   admins add/edit events right on the calendar (Google-style). Extracted from main.js
   so it can drive the standalone Events page. Self-inits on #calWrap. */
(function () {
  'use strict';

  var esc = ZBXIUtil.esc;

  var calWrap = document.getElementById('calWrap');
  if (!calWrap) return;

  var CAT_LABEL = { rush: 'Rush', philanthropy: 'Philanthropy', reunion: 'Reunion', meeting: 'Chapter Meeting', social: 'Social' };
  var EV_CATS = ['social', 'meeting', 'philanthropy', 'rush', 'reunion'];
  // IS_ADMIN is the webmaster; CAN_MANAGE is "may add/edit/delete events" and is
  // the flag every control below reads. The events RLS policies are already
  // `is_admin() OR officer_can('events.manage')`, so a granted officer could
  // always do this — the page just never showed him the buttons.
  var EV_ALL = [], IS_ADMIN = false, CAN_MANAGE = false, ME = null, selDay = null;
  var RSVPS = [], RSVP_DIR = {}, CAN_RSVP = false;
  var cal = (function () { var d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

  /* -- multi-day events -----------------------------------------------------
     These now live in event-when.js so the Officer and Admin consoles share one
     copy — they each had their own that ignored ends_at entirely. Aliased rather
     than inlined so every call site below stays untouched. */
  var EVW = window.ZBXIEvent;
  var sameDay = EVW.sameDay, evEnd = EVW.end, startOfDay = EVW.startOfDay;
  var evSpan = EVW.span, isMulti = EVW.isMulti, evTime = EVW.time;

  function evsOn(date) {
    var d = startOfDay(date).getTime();
    return EV_ALL.filter(function (e) {
      var sp = evSpan(e);
      return d >= sp.s.getTime() && d <= sp.e.getTime();
    });
  }

  function evLoc(e) {
    if (!e.location) return '';
    return ' · <a class="ev-loc" target="_blank" rel="noopener" href="https://maps.google.com/?q=' +
      encodeURIComponent(e.location) + '">📍 ' + esc(e.location) + '</a>';
  }

  function lockedCal() {
    calWrap.innerHTML = '<div class="bm__locked" style="max-width:560px;margin:0 auto">🔒 <b>The chapter calendar is members-only</b>' +
      '<span>Meetings, reunions, rush and philanthropy — with RSVPs — open when you sign in as a verified brother.</span>' +
      '<a class="btn btn--gold" href="' + ZBXIUtil.signInHref() + '">Log In / Sign Up</a></div>';
  }

  /* -- RSVPs -- */
  function rsvpsFor(id) { return RSVPS.filter(function (r) { return r.event_id === id; }); }
  function iGo(id) { return ME && RSVPS.some(function (r) { return r.event_id === id && r.user_id === ME.id; }); }
  function myRsvp(id) {
    return ME ? RSVPS.filter(function (r) { return r.event_id === id && r.user_id === ME.id; })[0] : null;
  }
  // The two numbers a host actually needs. "12 brothers" answers who is coming;
  // "19 with guests" is what he caters from. The second half only appears when
  // somebody is actually bringing someone, so an ordinary meeting reads plainly.
  function headcount(rs) {
    var g = rs.reduce(function (n, r) { return n + (r.guests || 0); }, 0);
    var b = rs.length + (rs.length === 1 ? ' brother' : ' brothers');
    return g ? b + ' · <b>' + (rs.length + g) + '</b> with guests' : b;
  }
  // 0-20 matches the database CHECK exactly. A shorter list would look tidier and
  // silently cap a real family at whatever number I picked, which then reads as a
  // wrong headcount rather than as a limit.
  function guestPicker(n) {
    var out = '';
    for (var i = 0; i <= 20; i++) {
      out += '<option value="' + i + '"' + (i === (n || 0) ? ' selected' : '') + '>' +
        (i === 0 ? 'just me' : '+' + i) + '</option>';
    }
    return '<select class="ev-rsvp__g" aria-label="How many guests are you bringing">' + out + '</select>';
  }
  function rsvpBar(e) {
    if (!CAN_RSVP) return '';
    var rs = rsvpsFor(e.id);
    // A past event's headcount is history: show it, but stop taking answers.
    // isPast keys on the END of the event, so a multi-day formal stays open
    // for its whole run.
    if (EVW && EVW.isPast && EVW.isPast(e)) {
      return '<div class="ev-rsvp ev-rsvp--past"><span class="ev-rsvp__n">' + headcount(rs) + '</span>' +
        '<small class="ev-rsvp__who">This event has passed.</small></div>';
    }
    var mine = myRsvp(e.id);
    var names = rs.map(function (r) {
      var m = RSVP_DIR[r.user_id];
      return m ? m.full_name.split(' ')[0] : 'a brother';
    });
    var who = names.length ? '<small class="ev-rsvp__who">Going: ' + esc(names.slice(0, 6).join(', ')) + (names.length > 6 ? ' +' + (names.length - 6) : '') + '</small>' : '';
    // Guests and the note only appear once you're going — asking "how many are you
    // bringing" of a brother who has not said he is coming is a question about nothing.
    var extra = mine
      ? '<span class="ev-rsvp__bring">Bringing: ' + guestPicker(mine.guests) + '</span>' +
        '<button type="button" class="ev-rsvp__notebtn">' + (mine.note ? '✎ note' : '✎ add a note') + '</button>'
      : '';
    var noteRow = mine && mine.note
      ? '<small class="ev-rsvp__note">“' + esc(mine.note) + '”</small>' : '';
    return '<div class="ev-rsvp" data-rsvp="' + e.id + '">' +
      '<button class="ev-rsvp__btn' + (mine ? ' on' : '') + '" aria-pressed="' + (!!mine) + '">' + (mine ? '✓ I\'m going' : '✋ I\'m going') + '</button>' +
      extra +
      '<span class="ev-rsvp__n">' + headcount(rs) + '</span>' +
      (CAN_MANAGE && rs.length ? '<button type="button" class="ev-rsvp__door">📋 Door list</button>' : '') +
      who + noteRow +
      '<span class="ev-rsvp__edit" hidden></span></div>';
  }
  function wireRsvps(scope) {
    scope.querySelectorAll('[data-rsvp]').forEach(function (bar) {
      var id = bar.dataset.rsvp;
      bar.querySelector('.ev-rsvp__btn').onclick = function () {
        if (!ME) return;
        var going = iGo(id);
        var op = going ? window.ZBXI.unrsvp(id, ME.id) : window.ZBXI.rsvp(id, ME.id);
        if (going) RSVPS = RSVPS.filter(function (r) { return !(r.event_id === id && r.user_id === ME.id); });
        else RSVPS.push({ event_id: id, user_id: ME.id, guests: 0, note: null });
        refresh();
        op.then(function (r) { if (r.error) window.ZBXI.rsvpList().then(function (l) { RSVPS = l; refresh(); }); });
      };
      var sel = bar.querySelector('.ev-rsvp__g');
      if (sel) sel.onchange = function () { saveRsvp(id, parseInt(sel.value, 10), undefined); };
      var nb = bar.querySelector('.ev-rsvp__notebtn');
      if (nb) nb.onclick = function () { openNoteBox(bar, id); };
      var door = bar.querySelector('.ev-rsvp__door');
      if (door) door.onclick = function () {
        var ev = EV_ALL.filter(function (x) { return x.id === id; })[0];
        if (ev) openDoorList(ev);
      };
    });
  }

  /* One line for the door — "+ wife and 2 kids", "arriving late". Revealed rather than
     always on screen: most RSVPs do not need one, and an empty box on every event is
     clutter that makes the bar look like a form. */
  function openNoteBox(bar, id) {
    var host = bar.querySelector('.ev-rsvp__edit');
    var mine = myRsvp(id);
    if (!host || !mine) return;
    if (!host.hidden) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = '<input class="ev-rsvp__notein" maxlength="140" placeholder="e.g. wife + 2 kids, arriving late" ' +
      'aria-label="A note for whoever is on the door">';
    var input = host.querySelector('.ev-rsvp__notein');
    input.value = mine.note || '';
    input.focus();
    // Saves on blur or Enter. No Save button: one field with one obvious meaning does
    // not need a second control to confirm it.
    var commit = function () { saveRsvp(id, undefined, input.value.trim()); };
    input.onblur = commit;
    input.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); } };
  }

  // guests/note are each optional so one control can save without clobbering the other.
  function saveRsvp(id, guests, note) {
    var mine = myRsvp(id);
    if (!mine || !ME) return;
    var g = guests === undefined ? (mine.guests || 0) : guests;
    var n = note === undefined ? (mine.note || null) : (note || null);
    mine.guests = g; mine.note = n;      // optimistic, like the going/not-going toggle
    refresh();
    window.ZBXI.rsvpUpdate(id, ME.id, g, n).then(function (r) {
      // A refusal removes no rows and returns 204 rather than raising, so an empty
      // result is the only signal that it did not take. Re-read rather than leaving
      // the screen showing a number the database never accepted.
      if ((r && r.error) || !r || !r.data || !r.data.length) {
        window.ZBXI.rsvpList().then(function (l) { RSVPS = l; refresh(); });
      }
    });
  }

  /* -- the door list -------------------------------------------------------------
     A report, not an editor: the brother on the door reads it, he does not change it.
     Everything on it is already in memory (RSVPS + the member directory), so opening
     it costs no query. Shown only to whoever can manage events — the same CAN_MANAGE
     flag that draws Edit and Delete. */
  function sortName(full) {
    var p = String(full || '').trim().split(/\s+/);
    return p.length > 1 ? p[p.length - 1] + ', ' + p.slice(0, -1).join(' ') : (p[0] || 'A brother');
  }
  function doorRows(e) {
    return rsvpsFor(e.id).map(function (r) {
      var m = RSVP_DIR[r.user_id] || {};
      return { name: sortName(m.full_name), cls: m.pledge_class || '', guests: r.guests || 0, note: r.note || '' };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function doorText(e) {
    var rows = doorRows(e);
    var total = rows.length + rows.reduce(function (n, r) { return n + r.guests; }, 0);
    return [e.title.toUpperCase(), evTime(e) + (e.location ? ' · ' + e.location : ''), ''].concat(
      rows.map(function (r) {
        return r.name + (r.cls ? ' (' + r.cls + ')' : '') + (r.guests ? ' +' + r.guests : '') +
               (r.note ? ' — ' + r.note : '');
      }),
      ['', rows.length + (rows.length === 1 ? ' brother' : ' brothers') + ' · ' + total + ' people expected']
    ).join('\n');
  }
  function openDoorList(e) {
    var m = document.getElementById('doorModal');
    if (!m) { m = document.createElement('div'); m.id = 'doorModal'; m.className = 'pmodal'; document.body.appendChild(m); }
    var rows = doorRows(e);
    var total = rows.length + rows.reduce(function (n, r) { return n + r.guests; }, 0);
    m.innerHTML = '<div class="pmodal__card card-form door">' +
      '<button class="pmodal__close" data-door-close aria-label="Close">✕</button>' +
      '<div id="doorSheet">' +
        '<h3 class="door__h">' + esc(e.title) + '</h3>' +
        '<p class="door__when">' + evTime(e) + (e.location ? ' · ' + esc(e.location) : '') + '</p>' +
        (rows.length
          ? '<table class="door__t"><tbody>' + rows.map(function (r) {
              return '<tr><td class="door__nm">' + esc(r.name) + '</td>' +
                '<td class="door__cls">' + esc(r.cls) + '</td>' +
                '<td class="door__g">' + (r.guests ? '+' + r.guests : '') + '</td>' +
                '<td class="door__note">' + esc(r.note) + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<p class="form-note">Nobody has RSVP\'d yet.</p>') +
        '<p class="door__tot"><b>' + rows.length + (rows.length === 1 ? ' brother' : ' brothers') +
          '</b> · ' + total + ' people expected</p>' +
      '</div>' +
      '<div class="door__acts">' +
        '<button class="btn btn--navy" id="doorPrint">🖨 Print</button>' +
        '<button class="btn btn--ghost" id="doorCopy">📋 Copy</button>' +
      '</div>' +
      '<p class="form-status" id="doorStatus" role="status"></p>' +
    '</div>';
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    function close() {
      m.classList.remove('open'); m.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onEsc);
      if (location.hash.indexOf('#door=') === 0) history.replaceState(null, '', location.pathname);
    }
    function onEsc(x) { if (x.key === 'Escape') close(); }
    m.querySelector('[data-door-close]').onclick = close;
    m.addEventListener('click', function (x) { if (x.target === m) close(); });
    document.addEventListener('keydown', onEsc);
    // window.print() on the page itself: the @media print block hides everything
    // except #doorSheet, so there is no popup to be blocked and no second page to
    // keep in sync with this one.
    m.querySelector('#doorPrint').onclick = function () { window.print(); };
    m.querySelector('#doorCopy').onclick = function () {
      var txt = doorText(e), st = m.querySelector('#doorStatus');
      var ok = function () { st.className = 'form-status ok'; st.textContent = '✓ Copied — paste it into a text or a group chat.'; };
      var no = function () { st.className = 'form-status err'; st.textContent = 'Could not copy automatically — print it instead.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(ok)['catch'](no);
      } else { no(); }
    };
  }

  /* -- layout: month grid + Up Next rail -- */
  function buildCalLayout() {
    calWrap.innerHTML = '<div class="cal-layout">' +
      '<div class="cal-main" id="calMain"></div>' +
      '<aside class="cal-rail" id="calRail"></aside>' +
    '</div>';
  }

  /* Clip each multi-day event to one week row and stack the results into lanes.
     A banner cannot wrap across a grid row, so an event crossing a week boundary
     becomes several segments; only the true first/last one gets a rounded end,
     which is what makes the middle segments read as "continues". */
  var MAX_LANES = 2;
  function bandSegments(list, wkStart) {
    var ws = wkStart.getTime();
    var we = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + 6).getTime();
    var segs = [];
    list.forEach(function (e) {
      var sp = evSpan(e), s = sp.s.getTime(), t = sp.e.getTime();
      if (t < ws || s > we) return;
      var c0 = s <= ws ? 0 : dayIndex(wkStart, sp.s);
      var c1 = t >= we ? 6 : dayIndex(wkStart, sp.e);
      // The banner is only clickable on a day this month actually shows.
      var day = 0;
      for (var k = c0; k <= c1 && !day; k++) {
        var d = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + k);
        if (d.getMonth() === cal.m && d.getFullYear() === cal.y) day = d.getDate();
      }
      segs.push({ e: e, c0: c0, c1: c1, day: day, isStart: s >= ws, isEnd: t <= we });
    });
    segs.sort(function (a, z) { return a.c0 - z.c0 || z.c1 - a.c1; });
    var laneEnd = [];
    return segs.filter(function (sg) {
      var lane = 0;
      while (lane < MAX_LANES && laneEnd[lane] != null && laneEnd[lane] >= sg.c0) lane++;
      if (lane >= MAX_LANES) return false;   // rare 3rd overlap stays a plain chip
      laneEnd[lane] = sg.c1;
      sg.lane = lane;
      return true;
    });
  }
  // Whole days between two local midnights. Rounded because a DST week is 167 or
  // 169 hours, not 168, and a bare division would drift by a column.
  function dayIndex(from, to) { return Math.round((to.getTime() - from.getTime()) / 864e5); }

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

    // One row per week so a multi-day banner can span with grid-column. Weeks are
    // walked as real dates (not day numbers), which is what makes an event running
    // in from the previous month paint correctly across the leading pad cells.
    var gridStart = new Date(cal.y, cal.m, 1 - startDow);
    var weeks = Math.ceil((startDow + daysInMonth) / 7);
    var spanning = EV_ALL.filter(isMulti);
    var rows = '';

    for (var w = 0; w < weeks; w++) {
      var wkStart = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7);
      var segs = bandSegments(spanning, wkStart);
      var lanes = segs.reduce(function (n, sg) { return Math.max(n, sg.lane + 1); }, 0);

      var bands = segs.map(function (sg) {
        return '<button class="cal-band cal-band--' + esc(sg.e.category) +
          (sg.isStart ? ' cal-band--start' : '') + (sg.isEnd ? ' cal-band--end' : '') +
          '" style="grid-column:' + (sg.c0 + 1) + '/' + (sg.c1 + 2) + ';grid-row:' + (sg.lane + 1) + '"' +
          (sg.day ? ' data-day="' + sg.day + '"' : ' disabled') + '>' + esc(sg.e.title) + '</button>';
      }).join('');

      var cells = '';
      for (var c = 0; c < 7; c++) {
        var date = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + c);
        if (date.getMonth() !== cal.m || date.getFullYear() !== cal.y) {
          cells += '<span class="cal-cell cal-cell--pad"></span>';
          continue;
        }
        var day = date.getDate();
        var evs = evsOn(date);
        // Multi-day events are already drawn as the banner above; a chip too would
        // double-render them. Clickability still keys off the full list.
        var chipped = evs.filter(function (e) { return !isMulti(e); });
        var chips = chipped.slice(0, 2).map(function (e) {
          return '<span class="cal-chip cal-chip--' + esc(e.category) + '">' + esc(e.title) + '</span>';
        }).join('') + (chipped.length > 2 ? '<span class="cal-more">+' + (chipped.length - 2) + '</span>' : '');
        var canClick = evs.length || CAN_MANAGE;
        cells += '<button class="cal-cell' + (sameDay(date, today) ? ' cal-cell--today' : '') +
          (evs.length ? ' cal-cell--has' : '') +
          // The mobile dot marks days whose event ISN'T already drawn as a
          // banner. Without this every banded day carried a dot repeating what
          // the bar above it already said, which is most of why the row looked
          // cluttered. Separate class from --has, which drives cursor + hover.
          (chipped.length ? ' cal-cell--dot' : '') +
          (selDay === day ? ' cal-cell--sel' : '') +
          '"' + (selDay === day ? ' aria-current="date"' : '') +
          (canClick ? ' data-day="' + day + '"' : ' disabled') + '>' +
          '<span class="cal-cell__n">' + day + '</span>' +
          // Reserve the height the banner overlay occupies so chips sit below it.
          // Height comes from --lanes in CSS so it tracks the mobile breakpoint.
          (lanes ? '<span class="cal-cell__bandpad"></span>' : '') +
          chips + '</button>';
      }

      rows += '<div class="cal-week" style="--lanes:' + lanes + '">' +
        (segs.length ? '<div class="cal-week__bands">' + bands + '</div>' : '') + cells + '</div>';
    }

    main.innerHTML = head + '<div class="cal-grid">' + dows + '</div>' +
      '<div class="cal-weeks">' + rows + '</div><div class="cal-detail" id="calDetail"></div>';

    main.querySelectorAll('[data-cal]').forEach(function (b) {
      b.onclick = function () {
        cal.m += parseInt(b.dataset.cal, 10);
        if (cal.m < 0) { cal.m = 11; cal.y--; }
        if (cal.m > 11) { cal.m = 0; cal.y++; }
        selDay = null;
        renderMonth();
      };
    });
    main.querySelectorAll('[data-day]').forEach(function (c) {
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
    var html = '<h3>' + date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + '</h3>';
    html += evs.map(function (e) {
      return '<div class="cal-detail__ev"><span class="event__tag">' + (CAT_LABEL[e.category] || esc(e.category)) + '</span>' +
        '<b>' + esc(e.title) + '</b><small>' + evTime(e) + evLoc(e) + '</small>' +
        (e.description ? '<p>' + esc(e.description) + '</p>' : '') + rsvpBar(e) +
        (CAN_MANAGE ? '<div class="cal-adminrow"><button class="cal-mini" data-ev-edit="' + e.id + '">✎ Edit</button><button class="cal-mini cal-mini--del" data-ev-del="' + e.id + '">🗑 Delete</button></div>' : '') +
      '</div>';
    }).join('');
    if (!evs.length && !CAN_MANAGE) { box.innerHTML = ''; selDay = null; return; }
    if (!evs.length) html += '<p class="cal-detail__none">Nothing on this day yet.</p>';
    if (CAN_MANAGE) html += '<button class="btn btn--gold cal-detail__add" data-ev-add>＋ Add event on this day</button>';
    box.innerHTML = html;
    wireRsvps(box);
    wireAdmin(box, date);
    if (changed && scroll) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // reflect selection ring without a full re-render
    document.querySelectorAll('#calMain .cal-cell--sel').forEach(function (c) { c.classList.remove('cal-cell--sel'); c.removeAttribute('aria-current'); });
    var cell = document.querySelector('#calMain .cal-cell[data-day="' + day + '"]');
    if (cell) { cell.classList.add('cal-cell--sel'); cell.setAttribute('aria-current', 'date'); }
  }

  function renderRail() {
    var rail = document.getElementById('calRail');
    if (!rail) return;
    var upcoming = EV_ALL.filter(function (e) { return evEnd(e).getTime() > Date.now(); })
      .sort(function (a, z) { return new Date(a.starts_at) - new Date(z.starts_at); })
      .slice(0, 4);
    var html = '<h2 class="cal-rail__h">⚡ Up Next</h2>';
    if (!upcoming.length) {
      html += '<p class="cal-rail__none">No upcoming events yet' + (CAN_MANAGE ? ' — add the first one below.' : ' — check back soon.') + '</p>';
    } else {
      html += upcoming.map(function (e) {
        var d = new Date(e.starts_at);
        return '<article class="unx" tabindex="0" role="button" data-goto="' + e.starts_at + '">' +
          '<div class="unx__date"><b>' + d.getDate() + '</b><span>' + d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase() + '</span></div>' +
          '<div class="unx__body"><span class="unx__cat unx__cat--' + esc(e.category) + '">' + (CAT_LABEL[e.category] || esc(e.category)) + '</span>' +
          '<b>' + esc(e.title) + '</b><small>' + evTime(e) + evLoc(e) + '</small>' + rsvpBar(e) + '</div></article>';
      }).join('');
    }
    if (CAN_MANAGE) html += '<button class="btn btn--gold cal-rail__add" data-ev-add-any>＋ Add an event</button>';
    html += '<button class="cal-rail__help" id="calHelpBtn">❓ How the calendar works</button>';
    rail.innerHTML = html;
    wireRsvps(rail);
    rail.querySelectorAll('.unx[data-goto]').forEach(function (card) {
      card.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target !== card) return;   // let a nested control have its own keys
        e.preventDefault(); card.click();
      });
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
        ZBXIAsk.confirm({ title: 'Delete event', body: 'Delete "' + e.title + '"? This cannot be undone.', ok: 'Delete', danger: true }, function () {
          window.ZBXI.eventDelete(e.id).then(reloadEvents);
        });
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
    var ymd = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var dateVal = ymd(sd);
    // Defaults to the start date, so an untouched single-day event still saves as one.
    var endDateVal = ed ? ymd(ed) : dateVal;
    var startVal = e.starts_at && !e.all_day ? pad2(sd.getHours()) + ':' + pad2(sd.getMinutes()) : '';
    var endVal = ed && !e.all_day ? pad2(ed.getHours()) + ':' + pad2(ed.getMinutes()) : '';
    m.innerHTML = '<div class="pmodal__card card-form">' +
      '<button class="pmodal__close" data-ev-close aria-label="Close">✕</button>' +
      '<h3 style="color:var(--heading);font-family:var(--display);margin-top:0">' + (ev ? 'Edit event' : 'Add event') + '</h3>' +
      '<div class="field"><label>Title *</label><input id="evmTitle" value="' + esc(e.title || '') + '" /></div>' +
      '<label class="evm-allday"><input type="checkbox" id="evmAllDay"' + (e.all_day ? ' checked' : '') + ' /> All-day event</label>' +
      '<div class="field"><label>Starts on *</label><input id="evmDate" type="date" value="' + dateVal + '" /></div>' +
      '<div class="field"><label>Ends on (leave as-is for a single day)</label><input id="evmEndDate" type="date" value="' + endDateVal + '" /></div>' +
      '<div class="evm-times" id="evmTimes"' + (e.all_day ? ' style="display:none"' : '') + '>' +
        '<div class="field"><label>Starts</label><input id="evmStart" type="time" value="' + startVal + '" /></div>' +
        '<div class="field"><label>Ends (optional)</label><input id="evmEnd" type="time" value="' + endVal + '" /></div>' +
      '</div>' +
      '<div class="field"><label>Location (optional — becomes a map link)</label><input id="evmLoc" value="' + esc(e.location || '') + '" placeholder="e.g. MacVittie Union, Geneseo" /></div>' +
      '<div class="field"><label>Category</label><select id="evmCat">' + EV_CATS.map(function (c) {
        return '<option value="' + c + '"' + (e.category === c ? ' selected' : '') + '>' + (CAT_LABEL[c] || c) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>Description (optional)</label><textarea id="evmDesc">' + esc(e.description || '') + '</textarea></div>' +
      // upgrade63: a reminder goes out a few days before the event to the brothers who
      // RSVP'd. This widens that one email to everyone whose address we hold — off by
      // default, because an accidental all-hands for a chapter meeting is 60 emails.
      '<label class="evm-allday"><input type="checkbox" id="evmRemindAll"' + (e.remind_all ? ' checked' : '') + ' /> 🔔 Remind everyone we can email, not just brothers who RSVP\'d</label>' +
      '<div class="evm-actions">' +
        '<button class="btn btn--navy" id="evmSave">' + (ev ? 'Save changes' : 'Add to calendar') + '</button>' +
        (ev ? '<button class="cal-mini cal-mini--del" id="evmDel">🗑 Delete</button>' : '') +
      '</div>' +
      '<p class="form-status" id="evmStatus"></p>' +
    '</div>';
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    function onEsc(x) { if (x.key === 'Escape') close(); }
    function close() { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); document.removeEventListener('keydown', onEsc); }
    m.querySelector('[data-ev-close]').onclick = close;
    m.addEventListener('click', function (x) { if (x.target === m) close(); });
    document.addEventListener('keydown', onEsc);
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
      var edv = m.querySelector('#evmEndDate').value || dv;
      if (edv < dv) { st.className = 'form-status err'; st.textContent = 'The end date cannot be before the start date.'; return; }
      // An end timestamp exists when the event spans days, or when a time was given.
      // Building it from edv rather than dv is the fix for multi-day events being
      // silently collapsed onto their start date on every save through this modal.
      var multiDay = edv !== dv;
      var row = {
        title: title,
        all_day: isAll,
        starts_at: new Date(dv + 'T' + (isAll ? '00:00' : t1)).toISOString(),
        ends_at: (multiDay || (!isAll && t2)) ? new Date(edv + 'T' + (isAll || !t2 ? '23:59' : t2)).toISOString() : null,
        location: m.querySelector('#evmLoc').value.trim() || null,
        category: m.querySelector('#evmCat').value,
        description: m.querySelector('#evmDesc').value.trim() || null,
        remind_all: m.querySelector('#evmRemindAll').checked
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
      ZBXIAsk.confirm({ title: 'Delete event', body: 'Delete "' + ev.title + '"? This cannot be undone.', ok: 'Delete', danger: true }, function () {
        window.ZBXI.eventDelete(ev.id).then(function () { close(); reloadEvents(); });
      });
    };
  }

  /* -- plain-English brief -- */
  function openCalHelp() {
    var m = document.getElementById('calHelpModal');
    if (!m) { m = document.createElement('div'); m.id = 'calHelpModal'; m.className = 'pmodal'; document.body.appendChild(m); }
    m.innerHTML = '<div class="pmodal__card card-form">' +
      '<button class="pmodal__close" data-hc aria-label="Close">✕</button>' +
      '<h3 style="color:var(--heading);font-family:var(--display);margin-top:0">How the calendar works</h3>' +
      '<div class="cal-helpbody">' +
      '<p><b>📅 Reading it.</b> Days with a colored chip have something happening. Click the day to see the details — time, place, and what it is. The colors are just categories (gold = social, green = philanthropy, and so on).</p>' +
      '<p><b>✋ RSVP.</b> Press “I\'m going” on any event so the chapter knows to expect you. Press it again to change your mind — no harm done.</p>' +
      '<p><b>📍 Getting there.</b> If an event shows a location, clicking it opens the map.</p>' +
      '<p><b>⚡ Up Next.</b> The list beside the calendar always shows the next few events, so you never have to hunt for them.</p>' +
      (CAN_MANAGE ? '<p><b>⚙ Running the calendar.</b> You can add and change events — click any day and press “＋ Add event on this day”, fill in the title and time, and it\'s live for every brother instantly. Use ✎ Edit or 🗑 Delete on an event to change it. No code, ever.</p>' : '') +
      '</div></div>';
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    function closeHelp() {
      m.classList.remove('open'); m.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onEsc);
    }
    function onEsc(x) { if (x.key === 'Escape') closeHelp(); }
    document.addEventListener('keydown', onEsc);
    m.querySelector('[data-hc]').onclick = closeHelp;
    m.addEventListener('click', function (x) { if (x.target === m) closeHelp(); });
  }

  /* -- boot -- */
  if (!(window.ZBXI && window.ZBXI.configured)) {
    lockedCal();
  } else {
    window.ZBXI.approvalState().then(function (state) {
      if (state === 'error') { ZBXIUtil.loadError(calWrap, 'the chapter calendar'); return; }
      if (state !== 'approved') { lockedCal(); return; }
      Promise.all([window.ZBXI.getUser(), window.ZBXI.eventsList(), window.ZBXI.rsvpList(), window.ZBXI.memberDirectory(),
        window.ZBXI.officerCan ? window.ZBXI.officerCan('events.manage') : Promise.resolve(false)]).then(function (res) {
        ME = res[0];
        EV_ALL = res[1] || [];
        RSVPS = res[2] || [];
        RSVP_DIR = res[3] || {};
        CAN_RSVP = true;
        IS_ADMIN = !!(ME && ME.email && window.ZBXI.adminEmail && ME.email.toLowerCase() === window.ZBXI.adminEmail);
        CAN_MANAGE = IS_ADMIN || !!res[4];
        buildCalLayout();
        renderMonth();
        renderRail();
        // events.html#door=<event id> — how the Admin and Officer consoles open the
        // door list. They keep ONE implementation (this one) rather than each growing
        // their own copy of a report built from data they would have to re-query.
        var d = /^#door=([0-9a-f-]{36})$/i.exec(location.hash || '');
        if (d && CAN_MANAGE) {
          var ev = EV_ALL.filter(function (x) { return x.id.toLowerCase() === d[1].toLowerCase(); })[0];
          if (ev) openDoorList(ev);
        }
      }).catch(function () { calWrap.innerHTML = '<p class="page-empty">Could not load the calendar — try refreshing.</p>'; });
    }).catch(lockedCal);
  }
})();
