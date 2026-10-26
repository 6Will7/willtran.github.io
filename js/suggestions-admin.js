/* Suggestions admin: review pending suggestions (approve/reject). Same token as other admin pages. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var tokenEl = document.getElementById('sg-admin-token');
  var pendingEl = document.getElementById('sg-admin-pending');
  var msgEl = document.getElementById('sg-admin-msg');

  try { tokenEl.value = sessionStorage.getItem('sugg_admin') || ''; } catch (e) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(ts) {
    try {
      return new Date(ts * 1000).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  function token() { return tokenEl.value.trim(); }

  function renderPending(list) {
    pendingEl.innerHTML = '';
    if (!list.length) {
      pendingEl.innerHTML = '<p class="rest-sub">Queue is empty — nothing to review.</p>';
      return;
    }
    list.forEach(function (e) {
      var div = document.createElement('div');
      div.className = 'admin-item';
      div.innerHTML =
        '<h4>' + esc(e.name) + '<span class="cat">' + esc(e.category || 'Other') + '</span></h4>' +
        '<div class="when">' + esc(fmtDate(e.created_at)) + '</div>' +
        '<p class="msg">' + esc(e.suggestion) + '</p>' +
        '<div class="admin-actions">' +
          '<button class="btn-approve" data-id="' + e.id + '" data-action="approve">Approve</button>' +
          '<button class="btn-reject" data-id="' + e.id + '" data-action="reject">Reject</button>' +
        '</div>';
      pendingEl.appendChild(div);
    });
    pendingEl.querySelectorAll('button[data-action]').forEach(function (b) {
      b.addEventListener('click', function () { review(b.getAttribute('data-id'), b.getAttribute('data-action')); });
    });
  }

  function api(body) {
    return fetch(WORKER_URL + '/suggestions/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function load() {
    var t = token();
    if (!t) return;
    try { sessionStorage.setItem('sugg_admin', t); } catch (e) {}
    api({ token: t, action: 'list' })
      .then(function (res) {
        if (!res.ok) {
          msgEl.textContent = res.j && res.j.error === 'unauthorized' ? 'Wrong token — try again.' : ((res.j && res.j.error) || 'Load failed.');
          return;
        }
        msgEl.textContent = '';
        renderPending(res.j.pending || []);
      })
      .catch(function () { msgEl.textContent = 'Could not reach the server — check your connection.'; });
  }

  function review(id, action) {
    api({ token: token(), action: action, id: id })
      .then(function (res) {
        if (!res.ok) { msgEl.textContent = (res.j && res.j.error) || 'Action failed.'; return; }
        msgEl.textContent = action === 'approve' ? 'Approved.' : 'Rejected.';
        renderPending(res.j.pending || []);
      })
      .catch(function () { msgEl.textContent = 'Could not reach the server.'; });
  }

  tokenEl.addEventListener('change', load);
  tokenEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
  if (token()) load();
})();
