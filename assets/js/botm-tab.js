/* Brother of the Month tab — shared by the Admin and Officer consoles (like
   email-tab.js). window.ZBXIBotmTab.render(q) draws the whole tool.

   THIS IS THE ONLY PLACE THE BALLOT IS READABLE. botm_votes returns rows to the admin and
   to an officer holding spotlight.manage, and to nobody else — a brother calling the same
   query gets his own vote and nothing more. That is RLS, not a filter written here, so
   this UI is convenience and not the gate.

   Crowning goes through crown_botm(), a SECURITY DEFINER verb: the button is a request and
   the database decides. Nothing here opens or closes a month — zbxi-botm does that on the
   1st, and crowns the vote leader itself (coin flip on a tie) if nobody got round to it. */
(function () {
  'use strict';
  var esc = ZBXIUtil.esc;

  /* ---------------- Brother of the Month (upgrade67) ----------------
     Replaces a hash of the current date. This tab is the only place the ballot is
     readable: botm_votes returns rows to the admin and to an officer holding
     spotlight.manage, and to nobody else — brothers see percentages only. If this tab
     ever shows a brother his own vote and calls it the ballot, the RLS policy changed.

     Crowning is a SECURITY DEFINER verb, not an update: the button is a request, and the
     database decides. Nothing here can open or close a month — zbxi-botm does that on the
     1st, and crowns the leader itself if this tab was never opened. */
  function render(q) {
    var Z = window.ZBXI;
    q.innerHTML = '<p class="admin-empty">Loading…</p>';
    // roster_detail, NOT family_public: this tab needs user_id (to name a voter and to
    // fill the manual-crown list), photo_url and bio (to warn before crowning a man whose
    // card would be empty). family_public carries none of the three, and PostgREST's
    // select('*') returns what exists without erroring — so every row silently read
    // undefined and the whole screen rendered blank. listVerifiedDetail also signs the
    // photo URLs, and roster_detail is readable by exactly this tab's two audiences.
    Promise.all([Z.botmHistory(), Z.listVerifiedDetail()]).then(function (res) {
      var cycles = res[0] || [];
      var roster = (res[1] || []).slice().sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
      var byId = {}; roster.forEach(function (b) { byId[b.id] = b; });
      var nameOf = function (id) { return (byId[id] || {}).full_name || '—'; };

      var now = new Date();
      var open = cycles.filter(function (c) {
        return !c.winner_brother && new Date(c.opens_at) <= now && new Date(c.closes_at) > now;
      })[0] || null;
      var due = cycles.filter(function (c) { return !c.winner_brother && new Date(c.closes_at) <= now; })[0] || null;
      var live = open || due;
      var past = cycles.filter(function (c) { return c.winner_brother; });

      if (!live) {
        q.innerHTML = '<p class="admin-hint">No month is open for voting. A new one opens ' +
          'automatically on the 1st.</p>' + historyHtml();
        return;
      }

      Promise.all([Z.botmTally(live.id), Z.botmVoters(live.id)]).then(function (r2) {
        var tally = r2[0] || [], voters = r2[1] || [];
        var total = tally.reduce(function (n, t) { return n + t.votes; }, 0);
        var topVotes = tally.length ? tally[0].votes : 0;
        var tied = tally.filter(function (t) { return t.votes === topVotes; });

        q.innerHTML =
          '<p class="admin-hint">Brothers vote here for who should be featured next. ' +
          'They see the running percentages; <b>only you see who voted for whom</b>. ' +
          'If you never crown anyone, the site crowns the leader on the 1st — and breaks a ' +
          'tie with a coin flip.</p>' +

          '<div class="acct-block"><h4>' +
            (due ? 'Closed, waiting for you' : 'Open for voting') +
            ' · ' + esc(monthLabel(live.period)) + '</h4>' +
            '<p class="form-note">' + esc(total + (total === 1 ? ' vote' : ' votes')) +
              ' · ' + (due ? 'closed ' : 'closes ') +
              esc(new Date(live.closes_at).toLocaleDateString()) + '</p>' +

            (tally.length
              ? '<div class="botm-admin__list">' + tally.map(function (t) {
                  var b = byId[t.brother_id] || {};
                  var warn = (!b.photo_url ? 'no photo' : '') + (!b.photo_url && !b.bio ? ', ' : '') + (!b.bio ? 'no bio' : '');
                  return '<div class="botm-admin__row">' +
                    '<span class="botm-admin__name">' + esc(nameOf(t.brother_id)) +
                      (warn ? ' <em class="botm-admin__warn">(' + esc(warn) + ')</em>' : '') + '</span>' +
                    '<span class="botm-admin__bar"><span style="width:' + Number(t.pct || 0) + '%"></span></span>' +
                    '<span class="botm-admin__pct">' + esc(t.votes) + ' · ' + esc(t.pct) + '%</span>' +
                    '<button class="btn btn--ghost" data-crown="' + esc(t.brother_id) + '">Crown him</button>' +
                  '</div>';
                }).join('') + '</div>'
              : '<p class="admin-empty">Nobody has voted yet.</p>') +

            (tied.length > 1
              ? '<p class="form-note"><b>It is a ' + tied.length + '-way tie</b> on ' + topVotes +
                ' vote(s). Left alone, the site picks between them at random on the 1st.</p>'
              : '') +

            '<div class="form-row" style="margin-top:.9rem">' +
              '<div class="field"><label>Or pick someone else entirely</label>' +
                '<select id="botmManual"><option value="">Choose a brother…</option>' +
                  roster.filter(function (b) { return b.user_id; }).map(function (b) {
                    return '<option value="' + esc(b.id) + '">' + esc(b.full_name) + '</option>';
                  }).join('') +
                '</select></div>' +
              '<div class="field" style="align-self:end">' +
                '<button class="btn btn--gold" id="botmCrownManual">Crown him</button></div>' +
            '</div>' +
            '<p class="form-status" id="botmStatus"></p>' +
          '</div>' +

          '<div class="acct-block"><h4>Who voted for whom</h4>' +
            '<p class="form-note">Private to you' +
              '. A brother can only ever see his own vote.</p>' +
            (voters.length
              ? '<table class="og-table"><thead><tr><th>Brother</th><th>Voted for</th><th>When</th></tr></thead><tbody>' +
                voters.map(function (v) {
                  var who = roster.filter(function (b) { return b.user_id === v.voter_user; })[0];
                  return '<tr><td>' + esc((who || {}).full_name || 'a brother') + '</td>' +
                         '<td>' + esc(nameOf(v.brother_id)) + '</td>' +
                         '<td>' + esc(new Date(v.updated_at).toLocaleDateString()) + '</td></tr>';
                }).join('') + '</tbody></table>'
              : '<p class="admin-empty">No votes yet.</p>') +
          '</div>' +
          historyHtml();

        function crown(id) {
          var s = document.getElementById('botmStatus');
          if (!id) { if (s) s.textContent = 'Pick a brother first.'; return; }
          if (s) { s.className = 'form-status'; s.textContent = 'Crowning…'; }
          Z.botmCrown(live.id, id).then(function (r) {
            if (r && r.error) {
              if (s) { s.className = 'form-status err'; s.textContent = r.error.message || 'Refused.'; }
              return;
            }
            render(q);
          });
        }
        q.querySelectorAll('[data-crown]').forEach(function (el) {
          el.onclick = function () { crown(el.getAttribute('data-crown')); };
        });
        var mb = document.getElementById('botmCrownManual');
        if (mb) mb.onclick = function () { crown((document.getElementById('botmManual') || {}).value); };
      });

      function monthLabel(p) {
        var d = new Date(p + 'T00:00:00');
        return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      }
      function historyHtml() {
        if (!past.length) return '';
        return '<div class="acct-block"><h4>Past winners</h4><table class="og-table">' +
          '<thead><tr><th>Month</th><th>Brother</th><th>Chosen by</th></tr></thead><tbody>' +
          past.map(function (c) {
            var how = c.winner_source === 'admin' ? 'the webmaster'
                    : c.winner_source === 'officer' ? 'an officer'
                    : c.winner_source === 'auto_tiebreak' ? 'coin flip (tie)'
                    : 'the vote';
            return '<tr><td>' + esc(monthLabel(c.period)) + '</td><td>' +
                   esc(nameOf(c.winner_brother)) + '</td><td>' + esc(how) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }
    });
  }
  window.ZBXIBotmTab = { render: render };
})();
