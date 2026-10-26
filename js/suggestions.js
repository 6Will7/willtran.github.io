/* Suggestion box: load approved suggestions, submit new ones for review. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var listEl = document.getElementById('sg-entries');
  var form = document.getElementById('sg-form');
  var formMsg = document.getElementById('sg-form-msg');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {
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

  function render(list) {
    if (!list.length) {
      listEl.innerHTML = '<p class="sg-empty">No suggestions yet — be the first.</p>';
      return;
    }
    listEl.innerHTML = '';
    list.forEach(function (s) {
      var div = document.createElement('div');
      div.className = 'sg-entry';
      div.innerHTML =
        '<p class="sg-name">' + esc(s.name) +
          '<span class="sg-date">' + esc(fmtDate(s.created_at)) + '</span>' +
          '<span class="sg-cat">' + esc(s.category || 'Other') + '</span></p>' +
        '<p>' + esc(s.suggestion) + '</p>';
      listEl.appendChild(div);
    });
  }

  fetch(WORKER_URL + '/suggestions')
    .then(function (r) { return r.json(); })
    .then(function (j) { render((j && j.suggestions) || []); })
    .catch(function () {
      listEl.innerHTML = '<p class="sg-empty">Could not load suggestions — try again later.</p>';
    });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = form.name.value.trim().slice(0, 50);
    var category = form.category.value;
    var suggestion = form.suggestion.value.trim().slice(0, 1000);
    formMsg.className = 'sg-form-msg';
    if (!name || !suggestion) {
      formMsg.classList.add('err');
      formMsg.textContent = 'Please add your name and a suggestion.';
      return;
    }
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    fetch(WORKER_URL + '/suggestions/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, category: category, suggestion: suggestion })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (res.ok && res.j && res.j.ok) {
          formMsg.classList.add('ok');
          formMsg.textContent = 'Thanks! Your suggestion is awaiting review and will appear once approved.';
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
