/* Earnings This Week — market-wide earnings calendar (worker /earnings/week),
   grouped by day, watchlist tickers starred and floated to the top of each day.
   "Notable only" filters to the GICS universe (S&P 500 + Russell 3000). */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var listEl = document.getElementById('earn-list');
  var metaEl = document.getElementById('earn-meta');
  var weekEl = document.getElementById('earn-week');
  var notableEl = document.getElementById('earn-notable');
  var filterEl = document.getElementById('earn-filter');

  var offset = 0;         // weeks from the current week
  var rows = [];
  var scope = 'market';
  var watchlist = [];
  var watchPromise = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isoOf(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function mondayOf(base) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    var dow = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - dow);
    return d;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
    return '$' + Number(v).toFixed(0);
  }
  function hourRank(h) { return h === 'bmo' ? 0 : h === 'dmh' ? 1 : h === 'amc' ? 2 : 3; }
  function hourLabel(h) {
    return h === 'bmo' ? 'Before open' : h === 'amc' ? 'After close' : h === 'dmh' ? 'During hours' : 'Time TBD';
  }
  function isWatch(sym) { return watchlist.indexOf(sym) !== -1; }
  function isNotable(sym) {
    return isWatch(sym) || (typeof GICS !== 'undefined' && !!GICS[sym]);
  }

  function resolveWatchlist() {
    if (watchPromise) return watchPromise;
    watchPromise = (async function () {
      var tok = null;
      try { tok = localStorage.getItem('wt_sync_token'); } catch (e) {}
      if (!tok) return [];
      try {
        var r = await fetch(WORKER_URL + '/sync/watchlist', { headers: { 'Authorization': 'Bearer ' + tok } });
        if (!r.ok) return [];
        var j = await r.json();
        return (j.tickers || []).map(function (t) { return String(t).toUpperCase(); });
      } catch (e) { return []; }
    })();
    return watchPromise;
  }

  function rowHTML(r) {
    var g = (typeof GICS !== 'undefined' && GICS[r.symbol]) || null;
    var nums;
    if (r.epsActual != null) {
      nums = '<strong>EPS ' + Number(r.epsActual).toFixed(2) + '</strong>' +
        (r.epsEstimate != null ? ' vs est ' + Number(r.epsEstimate).toFixed(2) : '') +
        (r.revenueActual != null ? ' · Rev <strong>' + fmtMoney(r.revenueActual) + '</strong>' +
          (r.revenueEstimate != null ? ' vs est ' + fmtMoney(r.revenueEstimate) : '') : '');
    } else {
      nums = (r.epsEstimate != null ? 'EPS est ' + Number(r.epsEstimate).toFixed(2) : 'EPS est —') +
        (r.revenueEstimate != null ? ' · Rev est ' + fmtMoney(r.revenueEstimate) : '');
    }
    var q = r.quarter ? ' · Q' + r.quarter + (r.year ? ' ' + r.year : '') : '';
    return '<div class="earn-row">' +
      '<a class="earn-sym" href="/stocks/?symbol=' + encodeURIComponent(r.symbol) + '">' +
      (isWatch(r.symbol) ? '<span class="earn-star">★</span> ' : '') + esc(r.symbol) + '</a>' +
      '<span class="earn-sector">' + (g ? esc(g.s) : '') + q + '</span>' +
      '<span class="earn-when ' + (r.hour === 'bmo' ? 'bmo' : '') + '">' + hourLabel(r.hour) + '</span>' +
      '<span class="earn-nums">' + nums + '</span></div>';
  }

  function render() {
    var q = filterEl.value.trim().toUpperCase();
    var rows2 = rows.filter(function (r) {
      if (notableEl.checked && !isNotable(r.symbol)) return false;
      if (q && r.symbol.indexOf(q) === -1) return false;
      return true;
    });
    var wlCount = rows2.filter(function (r) { return isWatch(r.symbol); }).length;
    metaEl.textContent = rows2.length + ' companies reporting' +
      (watchlist.length ? ' · ' + wlCount + ' on your watchlist' : '') +
      (scope === 'notable' ? ' · notable-names view (full calendar unavailable on the data plan)' : '') +
      '.';
    if (!rows2.length) {
      listEl.innerHTML = '<p class="earn-empty">Nothing matches for this week — try unticking "Notable companies only" or another week.</p>';
      return;
    }
    var html = '', lastDay = '';
    rows2.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var w = (isWatch(b.symbol) ? 1 : 0) - (isWatch(a.symbol) ? 1 : 0);
      if (w) return w;
      var h = hourRank(a.hour) - hourRank(b.hour);
      if (h) return h;
      return a.symbol < b.symbol ? -1 : 1;
    });
    rows2.forEach(function (r) {
      if (r.date !== lastDay) {
        html += '<div class="earn-day">' + fmtDate(r.date) + '</div>';
        lastDay = r.date;
      }
      html += rowHTML(r);
    });
    listEl.innerHTML = html;
  }

  async function load() {
    var mon = mondayOf(new Date());
    mon.setDate(mon.getDate() + offset * 7);
    var sun = new Date(mon.getTime() + 6 * 86400000);
    var from = isoOf(mon), to = isoOf(sun);
    weekEl.textContent = mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' +
      sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    listEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    metaEl.textContent = '';
    watchlist = await resolveWatchlist();
    try {
      var u = WORKER_URL + '/earnings/week?from=' + from + '&to=' + to +
        (watchlist.length ? '&symbols=' + encodeURIComponent(watchlist.join(',')) : '');
      var r = await fetch(u);
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'load failed');
      rows = j.calendar || [];
      scope = j.scope || 'market';
      render();
    } catch (e) {
      listEl.innerHTML = '<p class="earn-empty">Could not load the earnings calendar — try again in a bit.</p>';
    }
  }

  document.getElementById('earn-prev').addEventListener('click', function () { offset--; load(); });
  document.getElementById('earn-next').addEventListener('click', function () { offset++; load(); });
  document.getElementById('earn-this').addEventListener('click', function () { offset = 0; load(); });
  notableEl.addEventListener('change', render);
  filterEl.addEventListener('input', render);

  load();
})();
