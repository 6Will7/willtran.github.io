/* Movers & world indices — Yahoo Finance via the Cloudflare Worker.
   Movers come from Yahoo's predefined screeners (gainers / losers /
   most active); indices from daily chart closes. Both cached 15 min
   on the worker. If the worker predates the routes, the page says so
   instead of showing stale data. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var listEl = document.getElementById('mv-list');
  var idxEl = document.getElementById('mv-indices');
  var asofEl = document.getElementById('mv-asof');
  var msgEl = document.getElementById('mv-msg');
  var data = null, currentList = 'gainers';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPrice(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n == null || isNaN(n)) return '—';
    return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%';
  }
  function fmtVol(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }

  function renderIndices(list) {
    if (!list || !list.length) {
      idxEl.innerHTML = '<p class="mv-empty">Indices unavailable right now.</p>';
      return;
    }
    idxEl.innerHTML = list.map(function (x) {
      var cls = (x.pct == null) ? '' : (x.pct >= 0 ? 'up' : 'down');
      return '<div class="mv-index"><span class="mv-index-name">' + esc(x.name) + '</span>' +
        '<span class="mv-index-price">' + fmtPrice(x.price) + '</span>' +
        '<span class="mv-index-chg ' + cls + '">' + fmtPct(x.pct) + '</span></div>';
    }).join('');
  }

  function renderList() {
    if (!data) return;
    var rows = data[currentList] || [];
    if (!rows.length) {
      listEl.innerHTML = '<p class="mv-empty">No ' + currentList + ' right now.</p>';
      return;
    }
    var html = '<div class="mv-table-wrap"><table class="mv-table"><thead><tr>' +
      '<th>Symbol</th><th>Name</th><th class="num">Price</th><th class="num">Change</th>' +
      '<th class="num">% Change</th><th class="num">Volume</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var cls = (r.pct == null) ? '' : (r.pct >= 0 ? 'up' : 'down');
      html += '<tr><td><a href="/stocks/?symbol=' + esc(r.s) + '"><strong>' + esc(r.s) + '</strong></a></td>' +
        '<td>' + esc(r.name || '') + '</td>' +
        '<td class="num">' + fmtPrice(r.price) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPrice(r.chg) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(r.pct) + '</td>' +
        '<td class="num">' + fmtVol(r.vol) + '</td></tr>';
    });
    listEl.innerHTML = html + '</tbody></table></div>';
  }

  var tabs = document.querySelectorAll('.mv-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
      currentList = this.getAttribute('data-list');
      for (var j = 0; j < tabs.length; j++) {
        tabs[j].classList.toggle('active', tabs[j] === this);
      }
      renderList();
    });
  }

  // ?view=indices scrolls to the indices strip on arrival.
  try {
    if (new URLSearchParams(location.search).get('view') === 'indices') {
      setTimeout(function () {
        var h = document.querySelector('.mv-subhead');
        if (h) h.scrollIntoView({ behavior: 'smooth' });
      }, 400);
    }
  } catch (e) {}

  Promise.all([
    fetch(WORKER_URL + '/market/movers').then(function (r) { return r.json(); }),
    fetch(WORKER_URL + '/market/indices').then(function (r) { return r.json(); })
  ]).then(function (res) {
    var m = res[0], ix = res[1];
    if (m && m.error) throw new Error(m.error);
    data = m;
    renderList();
    if (m.asOf) {
      var d = new Date(m.asOf);
      asofEl.textContent = 'As of ' + d.toLocaleString('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
      });
    }
    if (ix && !ix.error) renderIndices(ix.indices);
    else if (idxEl) idxEl.innerHTML = '<p class="mv-empty">Indices unavailable right now.</p>';
  }).catch(function () {
    listEl.innerHTML = '';
    msgEl.textContent = 'Movers are unavailable right now — the data service may be updating. Try again in a few minutes.';
    if (idxEl) idxEl.innerHTML = '<p class="mv-empty">Indices unavailable right now.</p>';
  });
})();
