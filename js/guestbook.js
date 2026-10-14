/* Guestbook: approved entries + submission form. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var listEl = document.getElementById('gb-entries');
  var form = document.getElementById('gb-form');
  var formMsg = document.getElementById('gb-form-msg');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(ts) {
    try {
      return new Date(ts * 1000).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch (e) { return ''; }
  }

  // Share buttons
  var shareHolder = document.getElementById('gb-share');
  if (shareHolder && window.WTShare) {
    shareHolder.appendChild(window.WTShare.row(
      'https://willtran.org/guestbook/',
      'Sign Will Tran\'s guestbook'
    ));
  }

  fetch(WORKER_URL + '/guestbook')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var entries = (j && j.entries) || [];
      if (!entries.length) {
        listEl.innerHTML = '<p class="gb-empty">No entries yet — be the first to sign.</p>';
        return;
      }
      listEl.innerHTML = '';
      entries.forEach(function (e) {
        var div = document.createElement('article');
        div.className = 'gb-entry';
        div.innerHTML =
          '<div class="gb-name">' + esc(e.name) +
            '<span class="gb-date">' + esc(fmtDate(e.created_at)) + '</span></div>' +
          '<p>' + esc(e.message) + '</p>';
        listEl.appendChild(div);
      });
    })
    .catch(function () {
      listEl.innerHTML = '<p class="gb-empty">The guestbook is unavailable right now — try again later.</p>';
    });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    formMsg.className = 'gb-form-msg';
    formMsg.textContent = '';
    var name = form.name.value.trim().slice(0, 50);
    var message = form.message.value.trim().slice(0, 500);
    if (!name || !message) {
      formMsg.classList.add('err');
      formMsg.textContent = 'Please add your name and a message.';
      return;
    }
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    fetch(WORKER_URL + '/guestbook/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, message: message })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (res.ok && res.j && res.j.ok) {
          formMsg.classList.add('ok');
          formMsg.textContent = 'Thanks! Your note is awaiting review and will appear once approved.';
          form.reset();
        } else {
          formMsg.classList.add('err');
          formMsg.textContent = (res.j && res.j.error) || 'Submission failed — try again later.';
        }
      })
      .catch(function () {
        btn.disabled = false;
        formMsg.classList.add('err');
        formMsg.textContent = 'Submission failed — check your connection and try again.';
      });
  });
})();
