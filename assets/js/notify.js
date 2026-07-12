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
      case 'reply':       return { ic: '↩', text: '<b>' + esc(p.actor || 'A brother') + '</b> replied to “' + esc(p.title || 'your thread') + '”', href: 'board.html' + (p.thread_id ? '#thread=' + p.thread_id : '') };
      case 'approved':    return { ic: '🎉', text: 'You\'re <b>approved</b> — tap for your member orientation', href: 'welcome.html' };
      case 'new_pending': return { ic: '⏳', text: '<b>' + esc(p.name || 'A brother') + '</b> is awaiting verification', href: 'admin.html' };
      case 'suggestion':  return { ic: '💡', text: '<b>' + esc(p.actor || 'A brother') + '</b> dropped a suggestion: “' + esc(p.text || '') + '”', href: 'admin.html' };
      case 'suggestion_reply': return { ic: '💡', text: 'The webmaster replied to your suggestion: “' + esc(p.text || '') + '”', href: 'board.html' };
      case 'connect_request': return { ic: '🤝', text: '<b>' + esc(p.actor || 'A brother') + '</b> wants to connect — tap to email him back (' + esc(p.email || '') + ')', href: p.email ? 'mailto:' + esc(p.email) : '#' };
      case 'mentor_request': return { ic: '🎓', text: '<b>' + esc(p.actor || 'A brother') + '</b> is looking for a mentor in <b>' + esc(p.field || 'your field') + '</b>' + (p.note ? ': “' + esc(p.note) + '”' : '') + ' — tap to email him', href: p.email ? 'mailto:' + esc(p.email) + '?subject=' + encodeURIComponent('ΖΒΞ mentoring — ' + (p.field || '')) : '#' };
      default:            return { ic: '•', text: esc(n.kind), href: '#' };
    }
  }

  var wrap = null, list = [], unread = 0;

  function badge() {
    var b = wrap && wrap.querySelector('.bell__badge');
    if (!b) return;
    b.style.display = unread ? '' : 'none';
    b.textContent = unread > 9 ? '9+' : unread;
  }

  function renderList() {
    var box = wrap.querySelector('.bell__list');
    if (!list.length) { box.innerHTML = '<p class="bell__empty">No notifications yet.</p>'; return; }
    box.innerHTML = list.map(function (n) {
      var d = describe(n);
      return '<a class="bell__row' + (n.read ? '' : ' unread') + '" href="' + d.href + '">' +
        '<i>' + d.ic + '</i><span>' + d.text + '</span><em>' + when(n.created_at) + '</em></a>';
    }).join('');
  }

  function fetchNotifs() {
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
      '<button class="bell__btn" aria-label="Notifications">🔔<span class="bell__badge" style="display:none"></span></button>' +
      '<div class="bell__menu"><div class="bell__head">Notifications</div><div class="bell__list"></div></div>';
    host.parentNode.insertBefore(wrap, host);

    var btn = wrap.querySelector('.bell__btn');
    var menu = wrap.querySelector('.bell__menu');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      if (open) {
        renderList();
        if (unread) {
          Z.notifMarkAllRead().then(function () { unread = 0; badge(); });
        }
      }
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
