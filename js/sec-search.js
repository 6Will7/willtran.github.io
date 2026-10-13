/* SEC filing full-text search page. Queries the worker's /sec/search route. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var form = document.getElementById('secsearch-form');
  var symEl = document.getElementById('secsearch-symbol');
  var qEl = document.getElementById('secsearch-q');
  var filtersEl = document.getElementById('secsearch-filters');
  var metaEl = document.getElementById('secsearch-meta');
  var resEl = document.getElementById('secsearch-results');
  var forms = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  filtersEl.addEventListener('click', function (e) {
    var chip = e.target.closest('.rest-chip');
    if (!chip) return;
    forms = chip.getAttribute('data-forms');
    Array.prototype.forEach.call(filtersEl.querySelectorAll('.rest-chip'), function (c) {
      c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
    });
    if (symEl.value.trim() && qEl.value.trim()) runSearch();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    runSearch();
  });

  // deep link from /stocks/
  try {
    var p = new URLSearchParams(window.location.search);
    if (p.get('symbol')) symEl.value = p.get('symbol').toUpperCase().slice(0, 12);
    if (p.get('q')) qEl.value = p.get('q').slice(0, 200);
    if (symEl.value && qEl.value) runSearch();
  } catch (e) {}

  function runSearch() {
    var sym = symEl.value.trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '');
    var q = qEl.value.trim();
    if (!sym || q.length < 2) {
      metaEl.textContent = 'Enter a ticker and a search phrase (2+ characters).';
      return;
    }
    metaEl.textContent = 'Searching ' + sym + ' filings…';
    resEl.innerHTML = '<div class="loader-center"><div class="spinner" role="status" aria-label="Searching filings"></div></div>';
    var url = WORKER_URL + '/sec/search?symbol=' + encodeURIComponent(sym) +
      '&q=' + encodeURIComponent(q) + (forms ? '&forms=' + encodeURIComponent(forms) : '');
    fetch(url)
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok) {
          metaEl.textContent = '';
          resEl.innerHTML = '<div class="rest-empty">' + esc((r.j && r.j.error) || 'Search failed.') + '</div>';
          return;
        }
        var d = r.j, list = d.results || [];
        metaEl.textContent = list.length
          ? d.total + ' filing' + (d.total === 1 ? '' : 's') + ' mention "' + d.query + '"'
          : 'No filings mention "' + d.query + '".';
        if (!list.length) { resEl.innerHTML = ''; return; }
        resEl.innerHTML = list.map(function (h) {
          return '<a class="secsearch-hit" href="' + esc(h.url || '#') + '" target="_blank" rel="noopener">' +
            '<span class="secsearch-form-badge">' + esc(h.form || '?') + '</span>' +
            '<span class="secsearch-hit-main"><span class="secsearch-hit-company">' + esc(h.company || d.symbol) + '</span><br>' +
            '<span class="secsearch-hit-date">Filed ' + esc(h.date || '—') + '</span></span>' +
            '<span class="secsearch-arrow">→</span></a>';
        }).join('');
      })
      .catch(function () {
        metaEl.textContent = '';
        resEl.innerHTML = '<div class="rest-empty">Search failed — check your connection and try again.</div>';
      });
  }
})();
