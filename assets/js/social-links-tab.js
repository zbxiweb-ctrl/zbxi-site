/* Social links editor — shared by the admin console and the officer console the
   same way email-tab.js is. window.ZBXISocialLinksTab.render(q) draws the whole
   thing, so both consoles show one editor and there is no second copy to drift.

   What the chapter is editing here is the block of social buttons in the footer
   of the PUBLIC homepage. Until someone saves once, the site shows the link that
   was set up at launch and this editor prefills from it (ZBXI_CONFIG.SOCIAL_SEED)
   so the first thing an officer sees is their real link, not an empty box.

   The database re-validates everything on save (upgrade71: http/https only, 8
   links, 40-char labels) and RAISES on a bad value rather than quietly dropping
   it — so an error here is a real message worth showing the officer verbatim. */
(function () {
  'use strict';

  var esc = ZBXIUtil.esc;

  // net -> [glyph, default label]. Adding a network is one line; anything not
  // listed still works and shows the generic 🔗, which is why officers are not
  // limited to this list.
  var NETS = {
    facebook:  ['f',  'Facebook'],
    instagram: ['ig', 'Instagram'],
    x:         ['X',  'X'],
    linkedin:  ['in', 'LinkedIn'],
    tiktok:    ['♪',  'TikTok'],
    youtube:   ['▶',  'YouTube'],
    discord:   ['💬', 'Discord'],
    snapchat:  ['👻', 'Snapchat'],
    other:     ['🔗', 'Website']
  };
  var ORDER = ['facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'youtube', 'discord', 'snapchat', 'other'];

  var rows = [];      // working copy; nothing is saved until Save is pressed
  var dirty = false;

  function seedRows() {
    var cfg = window.ZBXI_CONFIG || {};
    var seed = cfg.SOCIAL_SEED;
    if (!seed || !seed.length) return [];
    return seed.filter(function (s) { return /^https?:\/\//i.test(s.url || ''); })
      .map(function (s) {
        var net = (s.net || 'other').toLowerCase();
        return { net: net, label: s.label || (NETS[net] || NETS.other)[1], url: s.url };
      });
  }

  function rowHtml(r, i) {
    var opts = ORDER.map(function (n) {
      return '<option value="' + n + '"' + (r.net === n ? ' selected' : '') + '>' +
        esc(NETS[n][1]) + '</option>';
    }).join('');
    return '<div class="admin-row" data-i="' + i + '">' +
      '<div class="admin-row__info" style="flex:1">' +
        '<div class="form-row">' +
          '<div class="field"><label>Network</label><select data-f="net">' + opts + '</select></div>' +
          '<div class="field"><label>Button text</label>' +
            '<input data-f="label" maxlength="40" value="' + esc(r.label) + '" placeholder="Instagram"></div>' +
        '</div>' +
        '<div class="field"><label>Web address</label>' +
          '<input data-f="url" maxlength="300" value="' + esc(r.url) + '" ' +
          'placeholder="https://instagram.com/yourchapter"></div>' +
      '</div>' +
      '<div class="admin-row__act">' +
        '<button class="btn btn--ghost" data-up' + (i === 0 ? ' disabled' : '') + ' title="Move up">↑</button>' +
        '<button class="btn btn--ghost" data-down title="Move down">↓</button>' +
        '<button class="btn btn--danger" data-del title="Remove">Remove</button>' +
      '</div></div>';
  }

  function render(q) {
    q.innerHTML = '<p class="admin-empty">Loading…</p>';
    ZBXI.socialLinks().then(function (saved) {
      if (!dirty) {
        rows = (saved && saved.length) ? saved.slice()
             : (saved ? [] : seedRows());   // saved-and-empty stays empty
      }
      paint(q, saved);
    })['catch'](function (e) {
      q.innerHTML = '<p class="admin-empty">Could not load the links: ' +
        esc((e && e.message) || 'unknown error') + '</p>';
    });
  }

  function paint(q, saved) {
    var never = !saved;
    q.innerHTML =
      '<p class="admin-hint">These are the social buttons at the bottom of your public homepage. ' +
      'Changes show up on the site as soon as you save — nothing to redeploy.</p>' +
      '<div class="acct-block">' +
        '<h4>🔗 Social links</h4>' +
        (never
          ? '<p class="form-note" style="margin-top:0">Your site is showing the link it launched with. ' +
            'It is prefilled below — edit it, add others, then save to take over.</p>'
          : '<p class="form-note" style="margin-top:0">Up to 8 links. Every address must start with ' +
            'http:// or https://.</p>') +
        '<div id="slRows">' +
          (rows.length ? rows.map(rowHtml).join('')
                       : '<p class="admin-empty">No links — your footer will show none.</p>') +
        '</div>' +
        '<div class="admin-addbar" style="margin-top:.8rem">' +
          '<button class="btn btn--ghost" id="slAdd"' + (rows.length >= 8 ? ' disabled' : '') + '>+ Add a link</button>' +
          '<button class="btn btn--gold" id="slSave">Save</button>' +
        '</div>' +
        '<p class="form-status" id="slStatus"></p>' +
      '</div>';

    // keep the working copy in step with typing, so add/remove never loses edits
    Array.prototype.forEach.call(q.querySelectorAll('#slRows .admin-row'), function (el) {
      var i = +el.getAttribute('data-i');
      Array.prototype.forEach.call(el.querySelectorAll('[data-f]'), function (inp) {
        inp.oninput = inp.onchange = function () {
          dirty = true;
          rows[i][inp.getAttribute('data-f')] = inp.value;
          if (inp.getAttribute('data-f') === 'net') {
            var lbl = el.querySelector('[data-f="label"]');
            var def = (NETS[inp.value] || NETS.other)[1];
            if (!lbl.value.trim() || ORDER.some(function (n) { return NETS[n][1] === lbl.value; })) {
              lbl.value = def; rows[i].label = def;
            }
          }
        };
      });
      el.querySelector('[data-del]').onclick = function () {
        dirty = true; rows.splice(i, 1); paint(q, saved);
      };
      el.querySelector('[data-up]').onclick = function () {
        if (i === 0) return;
        dirty = true; rows.splice(i - 1, 0, rows.splice(i, 1)[0]); paint(q, saved);
      };
      el.querySelector('[data-down]').onclick = function () {
        if (i >= rows.length - 1) return;
        dirty = true; rows.splice(i + 1, 0, rows.splice(i, 1)[0]); paint(q, saved);
      };
    });

    var add = q.querySelector('#slAdd');
    if (add) add.onclick = function () {
      if (rows.length >= 8) return;
      dirty = true;
      rows.push({ net: 'instagram', label: NETS.instagram[1], url: '' });
      paint(q, saved);
    };

    q.querySelector('#slSave').onclick = function () {
      var st = q.querySelector('#slStatus');
      // Check here so the officer gets a pointed message instead of the database's;
      // the database checks again regardless, and it is the one that decides.
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!/^https?:\/\//i.test((r.url || '').trim())) {
          st.className = 'form-status err';
          st.textContent = 'Link ' + (i + 1) + ' needs a web address starting with https://';
          return;
        }
        if (!(r.label || '').trim()) {
          st.className = 'form-status err';
          st.textContent = 'Link ' + (i + 1) + ' needs button text.';
          return;
        }
      }
      st.className = 'form-status'; st.textContent = 'Saving…';
      ZBXI.setSocialLinks(rows.map(function (r) {
        return { net: r.net, label: (r.label || '').trim(), url: (r.url || '').trim() };
      })).then(function () {
        dirty = false;
        st.className = 'form-status ok';
        st.textContent = rows.length
          ? 'Saved — your homepage footer is updated.'
          : 'Saved — the footer now shows no social links.';
        setTimeout(function () { render(q); }, 900);
      })['catch'](function (e) {
        st.className = 'form-status err';
        st.textContent = (e && e.message) || 'That did not save.';
      });
    };
  }

  window.ZBXISocialLinksTab = { render: render };
})();
