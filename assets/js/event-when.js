/* Shared event date maths — window.ZBXIEvent.
   ONE copy, deliberately, because the day-boundary rules below are subtle and
   have already been gotten wrong once: the Officer and Admin consoles each held
   their own copy that formatted from starts_at alone, so a 13-day Reunion read
   as a single moment ("Aug 7, 2026 · 11:55 PM") while the calendar page showed
   the correct range. Two copies drifted; three or four would drift again.

   Loaded as a plain <script> before events-page.js / officer.js / admin.js.
   Same one-global-per-file shape as ask-modal.js (ZBXIAsk), email-tab.js
   (ZBXIEmailTab) and turnstile.js (ZBXITurnstile) — no build step, no modules. */
(function () {
  'use strict';

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // A NULL ends_at means "no end was given" — treat it as three hours, not as
  // "ends the instant it starts", or every open-ended event reads as a point.
  function evEnd(e) {
    return e.ends_at ? new Date(e.ends_at) : new Date(new Date(e.starts_at).getTime() + 3 * 3600 * 1000);
  }

  /* An event covers every day from its start date through its end date. Compare
     whole DAYS, not timestamps: a 6pm-2am event ends on the following calendar
     day and must count as both. */
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function evSpan(e) {
    var s = startOfDay(new Date(e.starts_at));
    var t = startOfDay(evEnd(e));
    return { s: s, e: t < s ? s : t };
  }

  function isMulti(e) { var sp = evSpan(e); return sp.e.getTime() > sp.s.getTime(); }

  // Is the event over? Keyed on the END, not the start — otherwise a still-running
  // multi-day event is greyed out as "past" from its second day onward, which is
  // exactly what both consoles were doing.
  function isPast(e, now) { return evEnd(e).getTime() < (now || Date.now()); }

  function evTime(e) {
    var MD = { month: 'short', day: 'numeric' }, HM = { hour: 'numeric', minute: '2-digit' };
    var s = new Date(e.starts_at);
    if (isMulti(e)) {
      // Without the date on both ends, a 13-day event reads as a one-hour one.
      var end = evEnd(e);
      if (e.all_day) return s.toLocaleDateString(undefined, MD) + ' – ' + end.toLocaleDateString(undefined, MD);
      return s.toLocaleDateString(undefined, MD) + ', ' + s.toLocaleTimeString(undefined, HM) +
        ' – ' + end.toLocaleDateString(undefined, MD) + ', ' + end.toLocaleTimeString(undefined, HM);
    }
    if (e.all_day) return 'All day';
    var t = s.toLocaleTimeString(undefined, HM);
    if (e.ends_at && sameDay(s, new Date(e.ends_at))) {
      t += ' – ' + new Date(e.ends_at).toLocaleTimeString(undefined, HM);
    }
    return t;
  }

  /* Console-flavoured label: includes the YEAR (the consoles list events from any
     year, unlike the calendar which is already scoped to a month) and spells out
     a range. "Aug 7, 2026, 11:55 PM – Aug 19, 2026, 11:55 PM". */
  function evWhen(e) {
    var MDY = { month: 'short', day: 'numeric', year: 'numeric' }, HM = { hour: 'numeric', minute: '2-digit' };
    var s = new Date(e.starts_at);
    var startTxt = s.toLocaleDateString(undefined, MDY) + (e.all_day ? '' : ' · ' + s.toLocaleTimeString(undefined, HM));
    if (!isMulti(e)) return startTxt;
    var end = evEnd(e);
    return startTxt + ' – ' + end.toLocaleDateString(undefined, MDY) +
      (e.all_day ? '' : ' · ' + end.toLocaleTimeString(undefined, HM));
  }

  window.ZBXIEvent = {
    sameDay: sameDay,
    startOfDay: startOfDay,
    end: evEnd,
    span: evSpan,
    isMulti: isMulti,
    isPast: isPast,
    time: evTime,
    when: evWhen
  };
})();
