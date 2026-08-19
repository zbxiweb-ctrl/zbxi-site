/* In-site notification bell. Injects a bell button next to the account chip
   (#navAccount) for signed-in users: unread badge, dropdown list, mark-read
   on open. Fetches on load + window focus (no realtime needed). */
(function () {
  'use strict';
  var Z = window.ZBXI;
  if (!Z || !Z.configured) return;
  var host = document.getElementById('navAccount');
  if (!host) return;

  var onIndex = /(^|\/)(index\.html)?$/.test(location.pathname);

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function when(ts) {
    var d = new Date(ts), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + 'm';
    if (diff < 86400) return Math.round(diff / 3600) + 'h';
    return Math.round(diff / 86400) + 'd';
  }

  function describe(n) {
    var p = n.payload || {};
    switch (n.kind) {
      case 'like':        return { ic: '♥', text: '<b>' + esc(p.actor || 'A brother') + '</b> liked your photo', href: 'gallery.html' };
      case 'comment':     return { ic: '💬', text: '<b>' + esc(p.actor || 'A brother') + '</b> commented: “' + esc(p.text || '') + '”', href: 'gallery.html' };
      // upgrade60. The post id is escaped because it comes from the payload, same
      // reasoning as the new_pending href below — a literal in this file is safe, a
      // value out of the database is not.
      case 'photo_tag':   return { ic: '📷', text: '<b>' + esc(p.actor || 'A brother') + '</b> tagged you in a photo', href: 'gallery.html#p=' + esc(p.post_id || '') };
      case 'reply':       return { ic: '↩', text: '<b>' + esc(p.actor || 'A brother') + '</b> replied to “' + esc(p.title || 'your thread') + '”', href: 'board.html' + (p.thread_id ? '#thread=' + p.thread_id : '') };
      case 'approved':    return { ic: '🎉', text: 'You\'re <b>approved</b> — tap for your member orientation', href: 'welcome.html' };
      // Since upgrade44 an Alumni President can clear the queue too, and admin.html
      // is a wall for him. The trigger stamps the right console into the payload
      // when it writes the row — the browser must not try to work it out, because
      // "am I the admin?" is an async question and the list renders before the
      // answer lands. Rows written before upgrade44 have no href: they were all
      // the admin's, so that is the fallback.
      case 'new_pending': return { ic: '⏳', text: '<b>' + esc(p.name || 'A brother') + '</b> is awaiting verification', href: p.href === 'officer.html#members' ? p.href : 'admin.html' };
      case 'suggestion':  return { ic: '💡', text: '<b>' + esc(p.actor || 'A brother') + '</b> dropped a suggestion: “' + esc(p.text || '') + '”', href: 'admin.html#suggest' };
      // deep-link straight to the queue — landing on the default tab made the request look missing
      case 'title_request': return { ic: '🏅', text: '<b>' + esc(p.actor || 'A brother') + '</b> requested the title <b>' + esc(p.title || '') + ' · ' + esc(p.term || '') + '</b>', href: 'admin.html#titles' };
      case 'suggestion_reply': return { ic: '💡', text: 'Chapter leadership replied to your suggestion: “' + esc(p.text || '') + '”', href: 'board.html' };
      // These two used to be bare mailto: links. On a machine with no mail
      // handler registered a mailto: click does literally nothing — which is
      // exactly the "tap to email him back does nothing" report. Both now land
      // on the notifications page, which shows the address as copyable text
      // next to a pre-filled mail link, so the reply never depends on a handler.
      case 'connect_request': return { ic: '🤝', text: '<b>' + esc(p.actor || 'A brother') + '</b> wants to connect' + (p.note ? ': “' + esc(p.note) + '”' : '') + ' — open to reply', href: 'notifications.html#n=' + esc(n.id) };
      case 'mentor_request': return { ic: '🎓', text: '<b>' + esc(p.actor || 'A brother') + '</b> is looking for a mentor in <b>' + esc(p.field || 'your field') + '</b>' + (p.note ? ': “' + esc(p.note) + '”' : '') + ' — open to reply', href: 'notifications.html#n=' + esc(n.id) };
      default:            return { ic: '•', text: esc(n.kind), href: '#' };
    }
  }

  // Shared with notifications-page.js so the kind→copy map has exactly one home.
  // (Both surfaces render the same rows; a second copy would drift the moment a
  // new kind is added on one of them.) `refresh` lets that page re-pull the
  // badge after a bulk mark-read/clear, which otherwise sits stale until focus.
  window.ZBXINotify = { describe: describe, esc: esc, when: when, refresh: function () { fetchNotifs(); } };

  var wrap = null, list = [], unread = 0;

  function badge() {
    var b = wrap && wrap.querySelector('.bell__badge');
    if (!b) return;
    // The button's aria-label REPLACES its contents for a screen reader, so the
    // count has to be spoken here or it is never announced at all.
    var btn = wrap.querySelector('.bell__btn');
    if (btn) btn.setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' unread' : 'Notifications, none unread');
    b.style.display = unread ? '' : 'none';
    b.textContent = unread > 9 ? '9+' : unread;
  }

  function renderList() {
    var box = wrap.querySelector('.bell__list');
    if (!list.length) { box.innerHTML = '<p class="bell__empty">No notifications yet.</p>'; return; }
    box.innerHTML = list.map(function (n) {
      var d = describe(n);
      // esc() on href too: since upgrade44 one kind reads its destination from the
      // notification payload rather than a literal in describe(). That payload is
      // trigger-written and the value is whitelisted above, so this is defence in
      // depth — but an unescaped href is not a thing to leave sitting next to a
      // value that now comes from a table.
      return '<a class="bell__row' + (n.read ? '' : ' unread') + '" data-id="' + esc(n.id) + '" href="' + esc(d.href) + '" title="' + esc(new Date(n.created_at).toLocaleString()) + '">' +
        '<i>' + d.ic + '</i><span>' + d.text + '</span><em>' + when(n.created_at) + '</em></a>';
    }).join('');
  }

  function fetchNotifs() {
    if (!wrap) return;
    Z.getUser().then(function (u) {
      if (!u) return;
      Z.notifList().then(function (rows) {
        list = rows || [];
        unread = list.filter(function (n) { return !n.read; }).length;
        badge();
        if (wrap.querySelector('.bell__menu').classList.contains('open')) renderList();
      }).catch(function () {});
    });
  }

  function mount() {
    if (document.getElementById('notifBell')) return;
    wrap = document.createElement('div');
    wrap.className = 'bell';
    wrap.id = 'notifBell';
    wrap.innerHTML =
      '<button class="bell__btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">🔔<span class="bell__badge" style="display:none"></span></button>' +
      '<div class="bell__menu"><div class="bell__head">Notifications</div><div class="bell__list"></div>' +
      '<a class="bell__all" href="notifications.html">See all notifications →</a></div>';
    // Nav order must read: 🔔 bell → 🌙 theme toggle → profile chip. header-account.js
    // runs first and puts the toggle right before #navAccount, so insert the bell
    // ahead of the toggle (falling back to the chip when there's no toggle).
    var tgl = document.getElementById('themeToggle');
    host.parentNode.insertBefore(wrap, tgl || host);

    var btn = wrap.querySelector('.bell__btn');
    var menu = wrap.querySelector('.bell__menu');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.classList.toggle('open')) { announceOpen(); renderList(); }
    });

    /* ---- one header menu at a time -------------------------------------------
       The bell, the account menu and the mobile nav each call stopPropagation on
       their own toggle, so their own "click outside closes me" handler can't fire
       on the very click that opened them. The side effect was that the OTHER
       menus never heard that click either — so all three could sit open on top of
       each other, which on a phone is a wall of overlapping panels.

       Opening now announces itself and every other menu stands down. Deliberately
       an event rather than a shared registry: each file stays independent, no new
       script tag on 18 pages, and a page that doesn't load one of them just has
       nobody listening. */
    function announceOpen() {
      document.dispatchEvent(new CustomEvent('zbxi:menu', { detail: 'bell' }));
    }
    document.addEventListener('zbxi:menu', function (e) {
      if (e.detail !== 'bell') menu.classList.remove('open');
    });

    /* Read is earned by opening the row, not by glancing at the bell. Opening
       the menu used to mark EVERYTHING read, so anything you meant to come back
       to lost its unread mark before you'd looked at it. Marking here (rather
       than on the destination page) keeps it working for rows that link to
       gallery/board/admin, which know nothing about notifications. */
    wrap.querySelector('.bell__list').addEventListener('click', function (e) {
      var row = e.target.closest('.bell__row');
      if (!row) return;
      var id = row.getAttribute('data-id');
      var n = list.filter(function (x) { return x.id === id; })[0];
      if (!n || n.read) return;                  // nothing to do — let the link go
      // Hold the navigation until the write lands, otherwise unloading the page
      // cancels it and the row comes back unread.
      e.preventDefault();
      var href = row.getAttribute('href');
      n.read = true; unread = Math.max(0, unread - 1); badge();
      var go = function () { location.href = href; };
      Z.notifMarkRead(id).then(go, go);
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) menu.classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu.classList.remove('open'); });
  }

  function boot() {
    Z.getUser().then(function (u) {
      if (!u) { if (wrap) { wrap.remove(); wrap = null; } return; }
      mount();
      fetchNotifs();
    });
  }

  boot();
  Z.onAuth(function () { boot(); });
  window.addEventListener('focus', function () { if (wrap) fetchNotifs(); });

  /* ---- site-wide announcement banner (admin-set via site_settings) ---- */
  Z.getSetting('announcement').then(function (ann) {
    if (!ann || !ann.active || !ann.text) return;
    if (sessionStorage.getItem('zbxi_ann_dismissed') === String(ann.text)) return;
    var bar = document.createElement('div');
    bar.className = 'site-banner';
    var inner = ann.link
      ? '<a href="' + esc(ann.link) + '">' + esc(ann.text) + ' →</a>'
      : '<span>' + esc(ann.text) + '</span>';
    bar.innerHTML = '<div class="site-banner__inner">' + inner +
      '<button class="site-banner__x" aria-label="Dismiss">✕</button></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('has-banner');
    bar.querySelector('.site-banner__x').onclick = function () {
      sessionStorage.setItem('zbxi_ann_dismissed', String(ann.text));
      bar.remove();
      document.body.classList.remove('has-banner');
    };
  }).catch(function () {});
})();
