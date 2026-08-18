/* Edit a brother where you found him — shared modal, in the same pattern as
   email-tab.js / mentoring-tab.js / botm-tab.js.

   WHY THIS EXISTS. Every power in here already existed, in a console tab you had to
   remember. The webmaster went to the Mentoring page, saw active brothers listed as
   mentors, and had no way to act on the page he was looking at. The fix is not a new
   permission — it is putting the existing one where the mistake is visible.

   NO NEW DATABASE POWER, DELIBERATELY. Both roles write through the verbs they already
   use, so nothing here needs fresh auditing:
     • officer  -> officer_update_brother() + officer_set_open_to()
     • admin    -> updateBrother() (brothers_admin_update RLS) + officer_set_open_to()
   officer_update_brother has no parameter for role, role_scope, status or user_id, so no
   argument reaches them. That is the escalation boundary and this file does not move it.

   WHAT IS NOT HERE, ON PURPOSE. Status (pending/verified/rejected), 2FA reset, role /
   role term / board, and the positions-held history stay in the admin console. They are
   the escalation-sensitive and multi-step ones, and a modal opened from a photo on the
   gallery page is the wrong place to decide whether someone is a member.

   The button that opens this is rendered by profile-card.js only for the two roles that
   can use it — but a hidden button is not a permission, and the refusal that matters is
   the database's. */
(function () {
  'use strict';
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }

  /* powers: { admin: bool, officer: bool }. Resolved by profile-card.js and passed in, so
     this module never has to guess and the two callers cannot disagree about it. */
  function open(b, powers) {
    var Z = window.ZBXI;
    if (!b || !powers || (!powers.admin && !powers.officer)) return;
    var isAdmin = !!powers.admin;
    var OPEN_TO = (Z && Z.OPEN_TO) || [];

    var wrap = document.createElement('div');
    wrap.className = 'admin-modal open';

    function fld(label, key, val, type) {
      return '<div class="field"><label>' + esc(label) + '</label>' +
        '<input data-f="' + esc(key) + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"></div>';
    }

    // The roster, for the Big picker. Cached by listVerifiedDetail, so this is not a
    // fresh round trip on every card.
    Z.listVerifiedDetail().then(function (rows) {
      var roster = (rows || []).slice().sort(function (a, z) {
        return String(a.full_name).localeCompare(String(z.full_name));
      });
      var me = (roster.filter(function (r) { return r.id === b.id; })[0]) || b;
      var openNow = (me.open_to || []).slice();

      var bigOpts = ['<option value="">— none —</option>'].concat(
        roster.filter(function (v) { return v.id !== me.id; }).map(function (v) {
          return '<option value="' + esc(v.id) + '"' + (me.big_id === v.id ? ' selected' : '') + '>' + esc(v.full_name) + '</option>';
        })).join('');

      wrap.innerHTML =
        '<div class="admin-modal__card"><button class="admin-modal__close" data-x aria-label="Close">✕</button>' +
        '<h3>Edit ' + esc(me.full_name) + '</h3>' +
        '<p class="form-note" style="margin:0 0 .8rem">' +
          (isAdmin
            ? 'Status, titles and 2FA stay in the admin console — this is the man, not his membership.'
            : 'You can correct roster facts and his mentoring flags. Titles and status stay with the webmaster.') +
        '</p>' +

        '<div class="form-row">' + fld('Full name', 'full_name', me.full_name) +
                                   fld('Pledge class', 'pledge_class', me.pledge_class) + '</div>' +
        '<div class="form-row">' + fld('Grad year', 'grad_year', me.grad_year, 'number') +
          '<div class="field"><label>Big brother</label><select data-f="big_id">' + bigOpts + '</select></div></div>' +

        (isAdmin
          ? '<div class="field"><label>Active / Alumni</label><select data-f="standing">' +
              [['', 'Auto — from the grad year'], ['active', '🎓 Active brother'], ['alumni', '🏛 Alumni brother']]
                .map(function (o) {
                  return '<option value="' + o[0] + '"' + ((me.standing || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                }).join('') +
            '</select></div>' +
            '<div class="form-row">' + fld('City', 'city', me.city) + fld('Occupation', 'occupation', me.occupation) + '</div>' +
            '<div class="field"><label>Quote</label><input data-f="quote" value="' + esc(me.quote == null ? '' : me.quote) + '"></div>'
          : '') +

        '<div class="field"><label>He is open to…</label><div class="mtg-toggles">' +
          OPEN_TO.map(function (o) {
            // .mtg-toggle is the console's existing idiom for exactly these three
            // checkboxes — reused rather than inventing a class, which is how the first
            // pass rendered them unstyled.
            var on = openNow.indexOf(o.key) !== -1;
            return '<label class="mtg-toggle' + (on ? ' mtg-toggle--on' : '') + '">' +
              '<input type="checkbox" data-open="' + esc(o.key) + '"' + (on ? ' checked' : '') + '>' +
              '<span>' + esc(o.icon + ' ' + o.label) + '</span></label>';
          }).join('') +
          '</div><p class="form-note" style="margin:.4rem 0 0">He can change these himself on his own profile.</p></div>' +

        '<button class="btn btn--navy" data-save style="width:100%">Save changes</button>' +
        '<p class="form-status" data-status></p></div>';

      document.body.appendChild(wrap);

      function close() { wrap.remove(); }
      wrap.addEventListener('click', function (e) {
        if (e.target === wrap || e.target.closest('[data-x]')) close();
      });

      var status = wrap.querySelector('[data-status]');
      function val(k) { var el = wrap.querySelector('[data-f="' + k + '"]'); return el ? el.value : null; }

      wrap.querySelector('[data-save]').onclick = function () {
        status.className = 'form-status';
        status.textContent = 'Saving…';

        var chosen = [];
        wrap.querySelectorAll('[data-open]').forEach(function (el) {
          if (el.checked) chosen.push(el.getAttribute('data-open'));
        });

        /* BOTH roles go through officer_update_brother for the four shared fields.
           It accepts is_admin(), and it is the only path that validates:
             • a name of at least 2 characters — a direct write accepts '', which
               satisfies NOT NULL and renders the man nameless everywhere;
             • a graduation year in 1900-2100 — there is NO CHECK on the column, and
               grad_year is what decides Active vs Alumni across the whole site;
             • a brother cannot be his own big;
             • no cycle in big_id — the dangerous one. family-tree.js recurses from
               ROOTS, so everyone in a loop has a big, is not a root, and SILENTLY
               VANISHES from the tree with nothing reported.
           The first cut sent the admin straight to the table and skipped all four —
           giving the webmaster fewer seatbelts than his officer, from ten pages
           instead of one console. */
        var facts = Z.officerUpdateBrother(me.id, {
          full_name: (val('full_name') || '').trim(),
          pledge_class: val('pledge_class'),
          grad_year: val('grad_year'),
          big_id: val('big_id')
        });

        // The four fields officer_update_brother has no parameter for. Direct table
        // write (brothers_admin_update), and only AFTER the validated call succeeded.
        if (isAdmin) {
          facts = facts.then(function () {
            return Z.updateBrother(me.id, {
              standing: val('standing') || null,
              city: val('city') || null,
              occupation: val('occupation') || null,
              quote: val('quote') || null
            });
          });
        }

        facts
          .then(function (r) {
            if (r && r.error) throw r.error;
            // A PostgREST update refused by RLS returns 0 rows and NO error, so
            // without this the modal cheerfully says "Saved." for a write the
            // database threw away. updateBrother now asks for the rows back.
            if (r && r.data && !r.data.length) throw new Error('That change was refused.');
            return Z.officerSetOpenTo(me.id, chosen);
          })
          .then(function () {
            status.className = 'form-status ok';
            status.textContent = 'Saved.';
            // Reload rather than patch in place: this card is drawn on ten different
            // pages, each with its own list, and guessing which of them to refresh is
            // how a stale name survives a save.
            setTimeout(function () { window.location.reload(); }, 500);
          })
          ['catch'](function (e) {
            status.className = 'form-status err';
            status.textContent = (e && e.message) || 'That change was refused.';
          });
      };
    });
  }

  window.ZBXIBrotherEdit = { open: open };
})();
