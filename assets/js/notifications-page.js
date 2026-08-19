/* Full notification history (notifications.html): every row this brother has
   received, newest first, grouped by day, with per-row dismiss, mark-all-read
   and clear-all. The kind->copy map is NOT duplicated here — it comes from
   notify.js via window.ZBXINotify so the bell and this page can't drift apart.
   RLS scopes every read and write to the signed-in brother. Renders #notifRoot. */
(function () {
  'use strict';
  var root = document.getElementById('notifRoot');
  if (!root) return;
  var Z = window.ZBXI;

  function locked(msg, body, needSignin) {
    root.innerHTML = '<div class="bm__locked" style="max-width:520px;margin:0 auto">🔔 <b>' + msg + '</b>' +
      '<span>' + body + '</span>' +
      (needSignin ? '<a class="btn btn--gold" href="' + ZBXIUtil.signInHref('signin') + '">Log In / Sign Up</a>' : '') +
      '</div>';
  }

  if (!Z || !Z.configured) {
    locked('Members only', 'Your notifications are private to your account. Sign in to see them.', true);
    return;
  }

  var N = window.ZBXINotify;
  var esc = ZBXIUtil.esc;
  var me = null, rows = [];

  /* ---------- day grouping ---------- */
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(ts) {
    var d = new Date(ts), now = new Date();
    if (dayKey(ts) === dayKey(now)) return 'Today';
    if (dayKey(ts) === dayKey(new Date(now.getTime() - 86400000))) return 'Yesterday';
    var o = { weekday: 'long', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(undefined, o);
  }

  /* ---------- the two kinds you REPLY to ----------
     A connect/mentor request used to be a bare mailto: link, which does nothing
     at all on a machine with no mail handler registered — the reported "tap to
     email him back doesn't work". Here the address is always visible and always
     copyable, so replying never depends on a handler being installed. The mail
     link is a convenience on top, and unlike before it opens pre-filled. */
  function replyBlock(n) {
    var p = n.payload || {};
    if (!p.email) return '';
    var first = String(p.actor || '').split(' ')[0] || 'brother';
    var subj = n.kind === 'mentor_request'
      ? 'ΖΒΞ mentoring — ' + (p.field || '')
      : 'ΖΒΞ — connecting';
    var body = 'Hi ' + first + ',\n\n';
    var href = 'mailto:' + p.email + '?subject=' + encodeURIComponent(subj) +
               '&body=' + encodeURIComponent(body);
    return '<div class="ntf__reply">' +
      '<a class="btn btn--gold ntf__btn" href="' + esc(href) + '">Email ' + esc(first) + '</a>' +
      '<button type="button" class="btn btn--ghost ntf__btn" data-copy="' + esc(p.email) + '">Copy email</button>' +
      '<code class="ntf__addr">' + esc(p.email) + '</code>' +
      '</div>';
  }

  /* ---------- render ---------- */
  function render() {
    if (!rows.length) {
      root.innerHTML = '<div class="ntf"><p class="ntf__empty">🔔 <b>Nothing yet.</b>' +
        '<span>Replies to your threads, likes on your photos, and requests from other brothers all land here.</span></p></div>';
      return;
    }

    var unread = rows.filter(function (n) { return !n.read; }).length;
    var html = '<div class="ntf"><div class="ntf__bar">' +
      '<span class="ntf__count">' + (unread ? unread + ' unread' : 'All caught up') + '</span>' +
      '<span class="ntf__bar-actions">' +
        (unread ? '<button type="button" class="btn btn--ghost ntf__btn" data-markall>Mark all read</button>' : '') +
        '<button type="button" class="btn btn--ghost ntf__btn" data-clearall>Clear all</button>' +
      '</span></div>';

    var lastDay = null;
    rows.forEach(function (n) {
      var k = dayKey(n.created_at);
      if (k !== lastDay) { html += '<div class="ntf__day">' + esc(dayLabel(n.created_at)) + '</div>'; lastDay = k; }
      var d = N.describe(n);
      var reply = replyBlock(n);
      // A reply row acts on itself, so it isn't a link anywhere.
      var txt = reply
        ? '<span class="ntf__txt">' + d.text + '</span>'
        : '<a class="ntf__txt" href="' + d.href + '">' + d.text + '</a>';
      html += '<div class="ntf__row' + (n.read ? '' : ' unread') + '" id="n-' + esc(n.id) + '" data-id="' + esc(n.id) + '">' +
        '<i class="ntf__ic">' + d.ic + '</i>' +
        '<div class="ntf__body">' + txt + reply +
          '<em class="ntf__time" title="' + esc(new Date(n.created_at).toLocaleString()) + '">' + N.when(n.created_at) + ' ago</em>' +
        '</div>' +
        '<button type="button" class="ntf__x" data-del aria-label="Dismiss this notification">✕</button>' +
      '</div>';
    });

    html += '<p class="ntf__note">Notifications are kept for 90 days.</p></div>';
    root.innerHTML = html;
  }

  /* Keep the bell in step: without this, marking everything read here leaves the
     badge showing a count until the next window focus. */
  function syncBell() { if (N.refresh) N.refresh(); }

  function rowOf(el) { return el.closest('.ntf__row'); }
  function idOf(el) { var r = rowOf(el); return r && r.getAttribute('data-id'); }

  /* Repaint just the one row and the counter — NOT a full render(). A re-render
     would rebuild the row's innerHTML underneath whatever you just clicked,
     which throws away the "Copied ✓" confirmation and leaves its timer pointing
     at a detached button. */
  function paintRead(id) {
    var el = document.getElementById('n-' + id);
    if (el) el.classList.remove('unread');
    var unread = rows.filter(function (n) { return !n.read; }).length;
    var c = root.querySelector('.ntf__count');
    if (c) c.textContent = unread ? unread + ' unread' : 'All caught up';
    if (!unread) {
      var m = root.querySelector('[data-markall]');
      if (m) m.remove();
    }
  }

  function markRead(id) {
    var n = rows.filter(function (x) { return x.id === id; })[0];
    if (!n || n.read) return Promise.resolve();
    n.read = true;
    paintRead(id);
    return Z.notifMarkRead(id).then(function () { syncBell(); });
  }

  function wire() {
    root.addEventListener('click', function (e) {
      var t = e.target;

      var del = t.closest('[data-del]');
      if (del) {
        var did = idOf(del);
        del.disabled = true;
        Z.notifDelete(did).then(function (r) {
          if (r && r.error) { del.disabled = false; ZBXIAsk.alert({ title: 'Could not dismiss', body: r.error.message }); return; }
          rows = rows.filter(function (x) { return x.id !== did; });
          render(); syncBell();
        });
        return;
      }

      var copy = t.closest('[data-copy]');
      if (copy) {
        var addr = copy.getAttribute('data-copy');
        navigator.clipboard.writeText(addr).then(function () {
          copy.textContent = 'Copied ✓';
          setTimeout(function () { copy.textContent = 'Copy email'; }, 1600);
        }).catch(function () {
          // Clipboard blocked (permissions, or an insecure origin in dev). The
          // address is on screen either way — say so rather than failing mute.
          ZBXIAsk.alert({ title: 'Copy the address', body: addr });
        });
        markRead(idOf(copy));
        return;
      }

      var row = rowOf(t);
      if (!row) return;
      var id = row.getAttribute('data-id');
      var link = t.closest('a.ntf__txt');
      if (!link) { markRead(id); return; }
      // Let the write land before the page unloads, or it gets cancelled and the
      // row is still unread when you come back.
      e.preventDefault();
      var href = link.getAttribute('href');
      var go = function () { location.href = href; };
      markRead(id).then(go, go);
    });

    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-markall]')) {
        Z.notifMarkAllRead().then(function () {
          rows.forEach(function (n) { n.read = true; });
          render(); syncBell();
        });
      }
      if (e.target.closest('[data-clearall]')) {
        ZBXIAsk.confirm({
          title: 'Clear all notifications',
          body: 'Delete all ' + rows.length + ' notifications? This cannot be undone.',
          ok: 'Clear all', danger: true
        }, function () {
          Z.notifClearAll(me.id).then(function (r) {
            if (r && r.error) { ZBXIAsk.alert({ title: 'Could not clear', body: r.error.message }); return; }
            rows = []; render(); syncBell();
          });
        });
      }
    });
  }

  /* ---------- deep link from the bell (#n=<id>) ---------- */
  function focusHash() {
    var m = /[#&]n=([0-9a-f-]+)/i.exec(location.hash);
    if (!m) return;
    var el = document.getElementById('n-' + m[1]);
    // The row is gone — dismissed here, cleared from another tab, or aged out of
    // the 90-day window. Tapping a bell link and having the page do absolutely
    // nothing reads as a broken link, so say what happened.
    if (!el) { notifyGone(); return; }
    el.scrollIntoView({ block: 'center' });
    el.classList.add('ntf__row--flash');
    setTimeout(function () { el.classList.remove('ntf__row--flash'); }, 2200);
  }

  function notifyGone() {
    var box = root.querySelector('.ntf');
    if (!box || document.getElementById('notifGone')) return;
    var p = document.createElement('p');
    p.className = 'ntf__note';
    p.id = 'notifGone';
    p.textContent = 'That notification is no longer available.';
    box.insertBefore(p, box.firstChild);
  }

  Z.getUser().then(function (u) {
    if (!u) {
      locked('Members only', 'Your notifications are private to your account. Sign in to see them.', true);
      return;
    }
    me = u;
    return Z.notifListAll().then(function (list) {
      rows = list || [];
      render();
      wire();
      focusHash();
      // The bell lives on this page too, so its links only change the hash —
      // no reload fires and nothing would highlight without this.
      window.addEventListener('hashchange', focusHash);
    });
  }).catch(function () {
    locked('Couldn\'t load your notifications', 'Something went wrong reaching the server. Refresh to try again.', false);
  });
})();
