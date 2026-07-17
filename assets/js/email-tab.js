/* Email composer tab — shared by the Admin and Officer consoles (like
   ask-modal.js). window.ZBXIEmailTab.render(q) draws the whole tool; the
   zbxi-email edge function does the real work and re-checks authorization
   server-side, so this UI is convenience, not the gate.
   Recipients are resolved by the SERVER; brothers who unsubscribed are always
   skipped. Attachments: up to 4 files, 4 MB total, sent base64. */
(function () {
  'use strict';
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  var MAX_FILES = 4, MAX_BYTES = 4 * 1024 * 1024;

  function render(q) {
    var Z = window.ZBXI;
    q.innerHTML = '<p class="admin-empty">Loading brothers…</p>';
    Z.listVerifiedDetail().then(function (rows) {
      var members = (rows || []).filter(function (b) { return b.user_id; })
        .sort(function (a, z) { return String(a.full_name).localeCompare(String(z.full_name)); });
      var classes = {};
      members.forEach(function (b) { if (b.pledge_class) classes[b.pledge_class] = 1; });
      var clsOpts = Object.keys(classes).sort(function (a, z) { return a.localeCompare(z); })
        .map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

      q.innerHTML =
        '<div class="email-tab">' +
        '<p class="admin-hint">📧 Sends from the site\'s address in the navy ΖΒΞ shell. Recipients are brothers ' +
          'with accounts; anyone who unsubscribed is skipped automatically. Always send yourself a test first.</p>' +
        '<div class="field"><label>To</label><select id="emTo" class="zselect">' +
          '<option value="all">Every brother with an account</option>' +
          '<option value="class">One pledge class…</option>' +
          '<option value="pick">Pick brothers…</option>' +
        '</select></div>' +
        '<div class="field" id="emClassWrap" style="display:none"><label>Pledge class</label>' +
          '<select id="emClass" class="zselect">' + clsOpts + '</select></div>' +
        '<div id="emPickWrap" style="display:none">' +
          '<input class="admin-search" id="emPickSearch" type="search" placeholder="Search brothers…" />' +
          '<div id="emPickList" style="max-height:38vh;overflow-y:auto;margin:.5rem 0"></div>' +
          '<p class="form-note" id="emPickCount">0 selected</p>' +
        '</div>' +
        '<div class="field"><label>Subject</label><input id="emSubject" maxlength="200" placeholder="e.g. Homecoming details" /></div>' +
        '<div class="field"><label>Message</label><textarea id="emMsg" rows="8" placeholder="Plain text — line breaks are kept."></textarea></div>' +
        '<div class="field"><label>Attachments (optional — up to 4 files, 4 MB total)</label>' +
          '<input type="file" id="emFiles" multiple /><div id="emFileList" class="form-note"></div></div>' +
        '<div class="admin-addbar">' +
          '<button class="btn btn--ghost" id="emPreview">👁 Preview</button>' +
          '<button class="btn btn--ghost" id="emTest">Send a test to me</button>' +
          '<button class="btn btn--gold" id="emSend">Send</button>' +
        '</div>' +
        '<p class="form-status" id="emStatus" role="status"></p>' +
        '</div>';

      var picked = {};
      var files = [];          // [{filename, content(base64), type, size}]
      var status = q.querySelector('#emStatus');

      function drawPickList() {
        var filter = (q.querySelector('#emPickSearch').value || '').trim().toLowerCase();
        var list = members.filter(function (b) {
          return !filter || (b.full_name + ' ' + (b.pledge_class || '')).toLowerCase().indexOf(filter) !== -1;
        });
        q.querySelector('#emPickList').innerHTML = list.map(function (b) {
          return '<label class="pref-box" style="display:flex;gap:.6rem;align-items:center">' +
            '<input type="checkbox" data-pick="' + esc(b.id) + '"' + (picked[b.id] ? ' checked' : '') + '>' +
            '<span><b>' + esc(b.full_name) + '</b> <small>· ' + esc(b.pledge_class || '—') + '</small></span></label>';
        }).join('') || '<p class="admin-empty">No matches.</p>';
        q.querySelectorAll('[data-pick]').forEach(function (cb) {
          cb.onchange = function () {
            if (cb.checked) picked[cb.dataset.pick] = true; else delete picked[cb.dataset.pick];
            q.querySelector('#emPickCount').textContent = Object.keys(picked).length + ' selected';
          };
        });
      }

      var toSel = q.querySelector('#emTo');
      toSel.onchange = function () {
        q.querySelector('#emClassWrap').style.display = toSel.value === 'class' ? '' : 'none';
        q.querySelector('#emPickWrap').style.display = toSel.value === 'pick' ? '' : 'none';
        if (toSel.value === 'pick') drawPickList();
      };
      q.querySelector('#emPickSearch').oninput = drawPickList;

      q.querySelector('#emFiles').onchange = function (e) {
        var chosen = Array.prototype.slice.call(e.target.files || []);
        var total = chosen.reduce(function (n, f) { return n + f.size; }, 0);
        if (chosen.length > MAX_FILES) { say('⚠ Up to ' + MAX_FILES + ' attachments.', true); e.target.value = ''; return; }
        if (total > MAX_BYTES) { say('⚠ Attachments exceed 4 MB total.', true); e.target.value = ''; return; }
        files = [];
        if (!chosen.length) { q.querySelector('#emFileList').textContent = ''; return; }
        var pending = chosen.length;
        chosen.forEach(function (f) {
          var r = new FileReader();
          r.onload = function () {
            files.push({ filename: f.name, content: String(r.result).split(',')[1] || '', type: f.type || undefined, size: f.size });
            if (!--pending) {
              q.querySelector('#emFileList').textContent =
                files.map(function (x) { return x.filename + ' (' + Math.round(x.size / 1024) + ' KB)'; }).join(' · ');
            }
          };
          r.readAsDataURL(f);
        });
      };

      function say(msg, warn) {
        status.textContent = msg;
        status.style.color = warn ? '#e59a9a' : '';
      }
      function payload() {
        return {
          subject: q.querySelector('#emSubject').value.trim(),
          message: q.querySelector('#emMsg').value,
          mode: toSel.value,
          pledge_class: toSel.value === 'class' ? q.querySelector('#emClass').value : null,
          brother_ids: toSel.value === 'pick' ? Object.keys(picked) : [],
          attachments: files.map(function (f) { return { filename: f.filename, content: f.content, type: f.type }; })
        };
      }
      function ready() {
        var p = payload();
        if (!p.subject) { say('⚠ Add a subject first.', true); return null; }
        if (!p.message.trim()) { say('⚠ Write a message first.', true); return null; }
        if (p.mode === 'pick' && !p.brother_ids.length) { say('⚠ Pick at least one brother.', true); return null; }
        return p;
      }
      function busy(btn, on, label) { btn.disabled = on; btn.textContent = on ? 'Working…' : label; }

      var prevBtn = q.querySelector('#emPreview');
      prevBtn.onclick = function () {
        var p = ready(); if (!p) return;
        busy(prevBtn, true, '👁 Preview');
        Z.sendEmail(p, '?dry=1').then(function (r) { return r.text(); }).then(function (html) {
          var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
          window.open(url, '_blank');
          say('Preview opened in a new tab.');
        }).catch(function () { say('⚠ Could not build the preview.', true); })
          .finally(function () { busy(prevBtn, false, '👁 Preview'); });
      };

      var testBtn = q.querySelector('#emTest');
      testBtn.onclick = function () {
        var p = ready(); if (!p) return;
        busy(testBtn, true, 'Send a test to me');
        Z.sendEmail(p, '?test=1').then(function (r) { return r.json(); }).then(function (j) {
          say(j.sent ? '✓ Test sent to your inbox.' : '⚠ ' + (j.error || 'Test failed.'), !j.sent);
        }).catch(function () { say('⚠ Test failed.', true); })
          .finally(function () { busy(testBtn, false, 'Send a test to me'); });
      };

      var sendBtn = q.querySelector('#emSend');
      sendBtn.onclick = function () {
        var p = ready(); if (!p) return;
        busy(sendBtn, true, 'Send');
        // Exact recipient count comes from the server, then one explicit confirm.
        Z.sendEmail(p, '?count=1').then(function (r) { return r.json(); }).then(function (c) {
          if (c.error) { say('⚠ ' + c.error, true); throw new Error('handled'); }
          if (!c.recipients) { say('⚠ No recipients for that selection.', true); throw new Error('handled'); }
          var note = c.skipped_optout ? ' (' + c.skipped_optout + ' unsubscribed brother' + (c.skipped_optout === 1 ? '' : 's') + ' will be skipped)' : '';
          if (!confirm('Send “' + p.subject + '” to ' + c.recipients + ' brother' + (c.recipients === 1 ? '' : 's') + note + '?')) throw new Error('handled');
          return Z.sendEmail(p).then(function (r) { return r.json(); });
        }).then(function (j) {
          if (!j) return;
          say(j.sent ? '✓ Sent to ' + j.sent + ' of ' + j.attempted + ' brothers.' : '⚠ ' + (j.error || (j.errors || []).join('; ') || 'Send failed.'), !j.sent);
        }).catch(function (e) { if (String(e.message) !== 'handled') say('⚠ Send failed.', true); })
          .finally(function () { busy(sendBtn, false, 'Send'); });
      };
    }).catch(function () {
      q.innerHTML = '<p class="admin-empty">Could not load the brother list.</p>';
    });
  }

  window.ZBXIEmailTab = { render: render };
})();
