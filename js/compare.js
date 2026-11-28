/* Compare — several tickers on one normalized return scale.
   Prices come from the worker's /corr/prices (Yahoo adjusted closes,
   5y, cached 6h). Each line starts at 0% on the first day of the
   chosen range; missing trading days are forward-filled so the lines
   stay aligned. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed'];
  var RANGE_DAYS = { '1M': 22, '3M': 66, '6M': 132, '1Y': 252, '2Y': 504, '5Y': 100000 };
  var input = document.getElementById('cmp-input');
  var msgEl = document.getElementById('cmp-msg');
  var wrapEl = document.getElementById('cmp-chart-wrap');
  var chartEl = document.getElementById('cmp-chart');
  var legendEl = document.getElementById('cmp-legend');
  var tbodyEl = document.getElementById('cmp-tbody');
  var range = '1Y';
  var chart = null, series = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseTickers(raw) {
    var seen = {};
    return String(raw || '').toUpperCase().split(/[^A-Z0-9.\-]+/).filter(function (t) {
      if (!/^[A-Z0-9.\-]{1,12}$/.test(t) || seen[t]) return false;
      seen[t] = true;
      return true;
    }).slice(0, 5);
  }

  function buildChart() {
    if (chart) { chart.remove(); chart = null; series = []; }
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    chart = LightweightCharts.createChart(chartEl, {
      width: chartEl.clientWidth || 800,
      height: 340,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#d4d4d8' : '#52525b' },
      grid: { vertLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
              horzLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' } },
      rightPriceScale: { borderColor: dark ? '#3f3f46' : '#d4d4d8' },
      timeScale: { borderColor: dark ? '#3f3f46' : '#d4d4d8' },
      localization: { priceFormatter: function (p) { return p.toFixed(1) + '%'; } }
    });
  }

  function compare(symbols) {
    if (symbols.length < 2) {
      msgEl.textContent = 'Enter at least two tickers, separated by spaces or commas (up to 5).';
      return;
    }
    msgEl.textContent = 'Loading ' + symbols.join(', ') + '…';
    wrapEl.hidden = true;
    Promise.all(symbols.map(function (s) {
      return fetch(WORKER_URL + '/corr/prices?symbol=' + encodeURIComponent(s))
        .then(function (r) { return r.json(); })
        .then(function (d) { return { sym: s, data: d }; })
        .catch(function () { return { sym: s, data: null }; });
    })).then(function (results) {
      var good = results.filter(function (r) { return r.data && r.data.points && r.data.points.length > 30; });
      var bad = results.filter(function (r) { return !r.data || !r.data.points || r.data.points.length <= 30; })
        .map(function (r) { return r.sym; });
      if (good.length < 2) {
        msgEl.textContent = 'Could not load price history for these tickers.' +
          (bad.length ? ' No data for: ' + bad.join(', ') + '.' : '') +
          ' Check the tickers and try again.';
        return;
      }
      var maxDays = RANGE_DAYS[range];
      // Union of dates across tickers (US names share a calendar; ETFs
      // and ADRs can differ by a day, so align on the union and
      // forward-fill).
      var dateSet = {};
      var sliced = good.map(function (g) {
        var pts = g.data.points.slice(-maxDays);
        var base = pts[0][1];
        var byDate = {};
        pts.forEach(function (p) { byDate[p[0]] = (p[1] / base - 1) * 100; });
        pts.forEach(function (p) { dateSet[p[0]] = true; });
        return { sym: g.sym, pts: pts, base: base, byDate: byDate };
      });
      var dates = Object.keys(dateSet).sort();
      buildChart();
      series = [];
      var legend = '', rows = '';
      sliced.forEach(function (g, i) {
        var color = COLORS[i % COLORS.length];
        var s = chart.addLineSeries({ color: color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
        var line = [], last = 0;
        dates.forEach(function (d) {
          if (g.byDate[d] !== undefined) last = g.byDate[d];
          line.push({ time: d, value: Math.round(last * 100) / 100 });
        });
        s.setData(line);
        series.push(s);
        var first = g.pts[0][1], lastPx = g.pts[g.pts.length - 1][1];
        var ret = (lastPx / first - 1) * 100;
        var cls = ret >= 0 ? 'up' : 'down';
        legend += '<span class="cmp-leg"><i style="background:' + color + '"></i>' + esc(g.sym) +
          ' <b class="' + cls + '">' + (ret >= 0 ? '+' : '−') + Math.abs(ret).toFixed(1) + '%</b></span>';
        rows += '<tr><td><a href="/stocks/?symbol=' + esc(g.sym) + '"><strong>' + esc(g.sym) + '</strong></a></td>' +
          '<td class="num">$' + first.toFixed(2) + '</td><td class="num">$' + lastPx.toFixed(2) + '</td>' +
          '<td class="num ' + cls + '">' + (ret >= 0 ? '+' : '−') + Math.abs(ret).toFixed(2) + '%</td>' +
          '<td class="num">' + g.pts.length + '</td></tr>';
      });
      chart.timeScale().fitContent();
      legendEl.innerHTML = legend;
      tbodyEl.innerHTML = rows;
      wrapEl.hidden = false;
      msgEl.textContent = bad.length ? ('Note: no data for ' + bad.join(', ') + ' — skipped.') : '';
      try {
        var qp = new URLSearchParams(location.search);
        qp.set('symbols', symbols.join(','));
        history.replaceState(null, '', location.pathname + '?' + qp.toString());
      } catch (e) {}
    });
  }

  var tabs = document.querySelectorAll('.cmp-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
      range = this.getAttribute('data-range');
      for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('active', tabs[j] === this);
      var syms = parseTickers(input.value);
      if (syms.length >= 2) compare(syms);
    });
  }
  document.getElementById('cmp-form').addEventListener('submit', function (e) {
    e.preventDefault();
    compare(parseTickers(input.value));
  });
  var presets = document.querySelectorAll('.cmp-preset');
  for (var p = 0; p < presets.length; p++) {
    presets[p].addEventListener('click', function () {
      input.value = this.getAttribute('data-syms');
      compare(parseTickers(input.value));
    });
  }
  window.addEventListener('resize', function () {
    if (chart && chartEl.clientWidth) chart.applyOptions({ width: chartEl.clientWidth });
  });

  try {
    var q = new URLSearchParams(location.search).get('symbols');
    if (q) { input.value = q.replace(/,/g, ' '); compare(parseTickers(q)); }
  } catch (e) {}
})();
