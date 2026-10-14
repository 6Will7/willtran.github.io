/* Guestbook admin: review pending entries (approve/reject). Same token as restaurant admin. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var tokenEl = document.getElementById('gb-admin-token');
  var pendingEl = document.getElementById('gb-admin-pending');
  var msgEl = document.getElementById('gb-admin-msg');

  try { tokenEl.value = sessionStorage.getItem('gb_admin') || ''; } catch (e) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
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
        '<h4>' + esc(e.name) + '</h4>' +
        '<div class="when">' + esc(fmtDate(e.created_at)) + '</div>' +
        '<p class="msg">' + esc(e.message) + '</p>' +
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
    return fetch(WORKER_URL + '/guestbook/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function load() {
    var t = token();
    if (!t) {
      pendingEl.innerHTML = '<p class="rest-sub">Enter your token above to load the queue.</p>';
      return;
    }
    msgEl.textContent = '';
    pendingEl.innerHTML = '<div class="loader-center"><div class="spinner spinner-sm"></div></div>';
    api({ token: t, action: 'list' }).then(function (res) {
      if (res.ok && res.j && Array.isArray(res.j.pending)) {
        renderPending(res.j.pending);
      } else {
        msgEl.textContent = (res.j && res.j.error) || 'Could not load the queue.';
        pendingEl.innerHTML = '';
      }
    }).catch(function () {
      msgEl.textContent = 'Could not load the queue — check your connection.';
      pendingEl.innerHTML = '';
    });
  }

  function review(id, action) {
    msgEl.textContent = '';
    api({ token: token(), action: action, id: id }).then(function (res) {
      if (res.ok && res.j && res.j.ok) {
        renderPending(res.j.pending || []);
      } else {
        msgEl.textContent = (res.j && res.j.error) || 'Review failed.';
      }
    }).catch(function () {
      msgEl.textContent = 'Review failed — check your connection.';
    });
  }

  var deb = null;
  tokenEl.addEventListener('input', function () {
    try { sessionStorage.setItem('gb_admin', tokenEl.value.trim()); } catch (e) {}
    clearTimeout(deb);
    deb = setTimeout(load, 400);
  });

  // Auto-load when the portal pre-filled the token
  if (token()) load();
})();
