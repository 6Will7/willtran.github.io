/* Stocks page — live US quotes via the Cloudflare Worker proxy (Finnhub).
   Set WORKER_URL to your deployed worker URL, e.g. "https://stocks-quotes.<you>.workers.dev" */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev'; // <-- paste your worker URL here (no trailing slash)

  var $ = function (id) { return document.getElementById(id); };
  var searchInput = $('stocks-search'), goBtn = $('stocks-go');
  var setupBox = $('stocks-setup'), errorBox = $('stocks-error'), card = $('stocks-card');
  var chartEl = $('stocks-chart');
  var rangeChangeEl = $('range-change');

  var lwChart = null, lwMsg = null, priceLines = [];
  var areaSeries = null, candleSeries = null, volSeries = null;

  var currentSymbol = '', chartData = null, chartRange = '1D', prevClose = null;

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function clearError() { errorBox.hidden = true; errorBox.textContent = ''; }

  function fmtPrice(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtSigned(n) {
    if (n == null || isNaN(n)) return '—';
    var s = (n >= 0 ? '+' : '−') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return s;
  }
  function fmtBig(millions) {
    // Finnhub market cap comes in millions of USD
    if (millions == null || isNaN(millions)) return '—';
    var usd = millions * 1e6;
    if (usd >= 1e12) return '$' + (usd / 1e12).toFixed(2) + 'T';
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(usd).toLocaleString('en-US');
  }
  function fmtNum(n, digits) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits == null ? 2 : digits });
  }

  function api(path, params) {
    var url = WORKER_URL + '/' + path + '?symbol=' + encodeURIComponent(currentSymbol);
    Object.keys(params || {}).forEach(function (k) { url += '&' + k + '=' + encodeURIComponent(params[k]); });
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('request failed (' + r.status + ')');
      return r.json();
    });
  }

  function stat(label, value) {
    return '<div class="stocks-stat"><span class="stocks-stat-label">' + label +
      '</span><span class="stocks-stat-value">' + value + '</span></div>';
  }

  function search(raw) {
    var sym = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '');
    if (!sym) return;
    if (!WORKER_URL) { setupBox.hidden = false; return; }
    currentSymbol = sym;
    clearError();
    card.hidden = true;

    Promise.all([
      api('quote'),
      api('profile').catch(function () { return {}; }),
      api('metric').catch(function () { return {}; })
    ]).then(function (res) {
      var q = res[0] || {};
      if (!q.c) { showError('No quote data for "' + sym + '". Check the ticker and try again.'); return; }
      var profile = res[1] || {};
      var metric = (res[2] || {}).metric || {};
      prevClose = q.pc;
      renderHead(sym, q, profile);
      renderStats(q, profile, metric);
      card.hidden = false;
      loadChart(chartRange);
      loadFilings(sym);
      loadEstimates(sym);
      loadNews(sym);
    }).catch(function (e) {
      showError('Could not load ' + sym + ' — ' + e.message);
    });
  }

  function renderHead(sym, q, profile) {
    $('q-name').textContent = profile.name || sym;
    $('q-sym').textContent = sym + (profile.exchange ? ' · ' + profile.exchange : '') +
      (profile.currency ? ' · ' + profile.currency : '');
    $('q-price').textContent = fmtPrice(q.c);
    var chg = $('q-change');
    chg.textContent = fmtSigned(q.d) + ' (' + (q.dp >= 0 ? '+' : '−') +
      Math.abs(q.dp).toFixed(2) + '%)';
    chg.className = 'stocks-change ' + (q.d >= 0 ? 'up' : 'down');

    $('q-low').textContent = fmtPrice(q.l);
    $('q-high').textContent = fmtPrice(q.h);
    var span = (q.h - q.l);
    var pos = span > 0 ? Math.min(100, Math.max(0, (q.c - q.l) / span * 100)) : 50;
    $('q-marker').style.left = pos + '%';
  }

  function renderStats(q, profile, m) {
    var mcap = m.marketCapitalization || profile.marketCapitalization;
    var html =
      stat('Open', fmtPrice(q.o)) +
      stat('Previous close', fmtPrice(q.pc)) +
      stat('Day high', fmtPrice(q.h)) +
      stat('Day low', fmtPrice(q.l)) +
      stat('Market cap', fmtBig(mcap)) +
      stat('Enterprise value', fmtBig(m.enterpriseValue)) +
      stat('P/E (TTM)', fmtNum(m.peBasicExclExtraTTM)) +
      stat('52-week high', fmtPrice(m['52WeekHigh'])) +
      stat('52-week low', fmtPrice(m['52WeekLow'])) +
      stat('Beta', fmtNum(m.beta)) +
      stat('Dividend yield', m.dividendYieldIndicatedAnnual != null ?
        Number(m.dividendYieldIndicatedAnnual).toFixed(2) + '%' : '—');
    if (profile.finnhubIndustry || true) {
      var g = (typeof GICS !== 'undefined' && GICS[currentSymbol]) || null;
      html += stat('GICS sector', g ? g.s : '—');
      html += stat('GICS industry', g && g.i ? g.i : (profile.finnhubIndustry || '—'));
      html += stat('GICS sub-industry', g ? g.u : '—');
    }
    $('q-stats').innerHTML = html;
  }

  /* ---------- chart (TradingView Lightweight Charts) ---------- */

  var chartType = 'line'; // 'line' | 'candles'

  function loadChart(range, from, to) {
    chartRange = range;
    var tabs = document.querySelectorAll('.stocks-tabs [data-range]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-range') === range);
    }
    rangeChangeEl.textContent = '';
    rangeChangeEl.className = 'range-change';
    var url = WORKER_URL + '/chart?symbol=' + encodeURIComponent(currentSymbol) + '&range=' + range;
    if (from && to) url += '&from=' + from + '&to=' + to;
    // Price charts come from Yahoo Finance via the worker (Finnhub free tier blocks candles)
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.c || !d.c.length) throw new Error('no chart data');
        chartData = d;
        drawChart();
        updateRangeChange();
      })
      .catch(function () { chartData = null; rangeChangeEl.textContent = ''; drawChart(true); });
  }

  function updateRangeChange() {
    if (!chartData || chartData.c.length < 2) { rangeChangeEl.textContent = ''; return; }
    var first = chartData.c[0], last = chartData.c[chartData.c.length - 1];
    var pct = (last - first) / first * 100;
    var label = {
      '1D': 'today', '1W': 'past week', '1M': 'past month', 'YTD': 'YTD',
      '1Y': 'past year', '3Y': 'past 3 yrs', '5Y': 'past 5 yrs', 'CUSTOM': 'selected range'
    }[chartRange] || 'selected range';
    rangeChangeEl.textContent = (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(2) + '% ' + label;
    rangeChangeEl.className = 'range-change ' + (pct >= 0 ? 'up' : 'down');
  }

  function isDark() {
    if (document.documentElement.getAttribute('data-theme') === 'dark') return true;
    if (document.documentElement.getAttribute('data-theme') === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function chartPalette() {
    var dark = isDark();
    return {
      dark: dark,
      bg: dark ? '#1b1a1f' : '#fbfaf3',
      text: dark ? '#a9a8b1' : '#475569',
      grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      border: dark ? '#2e2d34' : '#e2e8f0',
      up: dark ? '#FCDD09' : '#16a34a',
      down: '#DA121A',
      crosshair: dark ? '#FCDD09' : '#2563eb'
    };
  }

  function hasOHLC() {
    return !!(chartData && chartData.o && chartData.o.length === chartData.c.length);
  }

  function ensureChart() {
    if (lwChart || typeof LightweightCharts === 'undefined') return;
    var p = chartPalette();
    lwChart = LightweightCharts.createChart(chartEl, {
      width: chartEl.clientWidth,
      height: chartEl.clientHeight,
      layout: {
        background: { type: 'solid', color: p.bg },
        textColor: p.text,
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      },
      grid: {
        vertLines: { color: p.grid },
        horzLines: { color: p.grid }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: p.crosshair, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: p.crosshair },
        horzLine: { color: p.crosshair, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: p.crosshair }
      },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false },
      localization: { locale: 'en-US' }
    });
    areaSeries = lwChart.addAreaSeries({
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true
    });
    candleSeries = lwChart.addCandlestickSeries({
      priceLineVisible: false, lastValueVisible: true, borderVisible: false
    });
    volSeries = lwChart.addHistogramSeries({
      priceScaleId: 'vol', priceFormat: { type: 'volume' },
      lastValueVisible: false, priceLineVisible: false
    });
    lwChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    lwMsg = document.createElement('div');
    lwMsg.className = 'stocks-chart-msg';
    lwMsg.hidden = true;
    chartEl.appendChild(lwMsg);

    // re-theme live when the site theme toggle flips
    new MutationObserver(function () { applyChartTheme(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // keep the chart sized to its container
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (lwChart) lwChart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
      }).observe(chartEl);
    } else {
      window.addEventListener('resize', function () {
        if (lwChart) lwChart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
      });
    }
  }

  function applyChartTheme() {
    if (!lwChart) return;
    var p = chartPalette();
    lwChart.applyOptions({
      layout: { background: { type: 'solid', color: p.bg }, textColor: p.text },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      crosshair: {
        vertLine: { color: p.crosshair, labelBackgroundColor: p.crosshair },
        horzLine: { color: p.crosshair, labelBackgroundColor: p.crosshair }
      },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border }
    });
    paintSeries();
    if (chartData && hasOHLC()) volSeries.setData(buildVolData());
  }

  function hexA(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function paintSeries() {
    if (!lwChart || !chartData) return;
    var p = chartPalette();
    var closes = chartData.c;
    var up = closes[closes.length - 1] >= closes[0];
    var line = up ? p.up : p.down;
    areaSeries.applyOptions({
      lineColor: line,
      topColor: hexA(line, 0.28),
      bottomColor: hexA(line, 0)
    });
    candleSeries.applyOptions({
      upColor: line, downColor: p.down,
      wickUpColor: line, wickDownColor: p.down
    });
  }

  function volColor(open, close) {
    var p = chartPalette();
    return hexA(close >= open ? p.up : p.down, 0.45);
  }

  function buildVolData() {
    var vols = [];
    for (var i = 0; i < chartData.t.length; i++) {
      vols.push({
        time: chartData.t[i],
        value: chartData.v[i] || 0,
        color: volColor(chartData.o[i], chartData.c[i])
      });
    }
    return vols;
  }

  function clearPriceLines() {
    for (var i = 0; i < priceLines.length; i++) {
      try { priceLines[i].s.removePriceLine(priceLines[i].l); } catch (e) {}
    }
    priceLines = [];
  }

  function addPrevCloseLine() {
    if (chartRange !== '1D' || !prevClose || !lwChart) return;
    var s = (chartType === 'candles' && hasOHLC()) ? candleSeries : areaSeries;
    var p = chartPalette();
    priceLines.push({ s: s, l: s.createPriceLine({
      price: prevClose,
      color: p.text,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'prev close'
    }) });
  }

  function refreshSeriesVisibility() {
    if (!lwChart) return;
    var candles = chartType === 'candles' && hasOHLC();
    areaSeries.applyOptions({ visible: !candles });
    candleSeries.applyOptions({ visible: candles });
    volSeries.applyOptions({ visible: candles });
  }

  function updateTypeToggle() {
    var wrap = $('chart-type-toggle');
    if (!wrap) return;
    var show = hasOHLC();
    wrap.style.display = show ? '' : 'none';
    if (!show && chartType === 'candles') chartType = 'line';
    var btns = wrap.querySelectorAll('[data-chart-type]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-chart-type') === chartType);
    }
  }

  function drawChart(empty) {
    ensureChart();
    if (!lwChart) return; // library failed to load; chart area stays blank
    clearPriceLines();
    if (empty || !chartData || chartData.c.length < 2) {
      [areaSeries, candleSeries, volSeries].forEach(function (s) { s.setData([]); });
      refreshSeriesVisibility();
      lwMsg.hidden = false;
      lwMsg.textContent = empty ? 'Chart unavailable' : 'Loading…';
      return;
    }
    lwMsg.hidden = true;
    paintSeries();
    var n = chartData.t.length, i;
    var area = [], candles = [], ohlc = hasOHLC();
    for (i = 0; i < n; i++) {
      area.push({ time: chartData.t[i], value: chartData.c[i] });
      if (ohlc) {
        candles.push({
          time: chartData.t[i], open: chartData.o[i],
          high: chartData.h[i], low: chartData.l[i], close: chartData.c[i]
        });
      }
    }
    areaSeries.setData(area);
    candleSeries.setData(candles);
    volSeries.setData(ohlc ? buildVolData() : []);
    updateTypeToggle();
    addPrevCloseLine();
    refreshSeriesVisibility();
    lwChart.timeScale().fitContent();
  }

/* ---------- wiring ---------- */

  /* ---------- SEC filings ---------- */

  var allFilings = [];
  var filingsList = $('filings-list');

  function fmtDate(iso) {
    if (!iso) return '—';
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }

  function badgeClass(form) {
    if (form.indexOf('10-K') === 0) return 'f-10k';
    if (form.indexOf('10-Q') === 0) return 'f-10q';
    return 'f-8k';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderFilings(filter) {
    var rows = allFilings.filter(function (f) {
      return filter === 'ALL' || f.form.indexOf(filter) === 0;
    }).slice(0, 12);
    if (!rows.length) {
      filingsList.innerHTML = '<div class="filings-empty">No ' +
        (filter === 'ALL' ? '' : esc(filter) + ' ') + 'filings found for this ticker.</div>';
      return;
    }
    filingsList.innerHTML = rows.map(function (f) {
      return '<div class="filing-row">' +
        '<span class="filing-badge ' + badgeClass(f.form) + '">' + esc(f.form) + '</span>' +
        '<span class="filing-meta"><strong>Filed ' + esc(fmtDate(f.filingDate)) + '</strong>' +
        ' · Period ended ' + esc(fmtDate(f.reportDate)) + '</span>' +
        '<span class="filing-links">' +
        '<a href="' + esc(f.docUrl) + '" target="_blank" rel="noopener">Document</a>' +
        '<a href="' + esc(f.indexUrl) + '" target="_blank" rel="noopener">Index</a>' +
        '</span></div>';
    }).join('');
  }

  function loadEstimates(sym) {
    var box = $('q-estimates');
    box.hidden = true;
    box.innerHTML = '';
    var now = new Date(), future = new Date();
    future.setDate(future.getDate() + 150); // upcoming earnings live in a future window
    function iso(d) { return d.toISOString().slice(0, 10); }
    Promise.all([
      api('recommendation').catch(function () { return null; }),
      api('earnings').catch(function () { return null; }),
      api('earnings-calendar', { from: iso(now), to: iso(future) }).catch(function () { return null; }),
      api('financials', { freq: 'quarterly' }).catch(function () { return null; })
    ]).then(function (res) {
      if (currentSymbol === sym) renderEstimates(res[0], res[1], res[2], res[3]);
    });
  }

  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Number(n).toFixed(0);
  }

  // Reusable section header: title + muted subtitle.
  function blockHead(title, sub) {
    return '<div class="est-head"><h3>' + title + '</h3>' +
      (sub ? '<span class="est-sub">' + sub + '</span>' : '') + '</div>';
  }

  function renderEstimates(rec, earn, calData, finData) {
    var box = $('q-estimates');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var html = '';

    if (rec && rec.length) {
      var r = rec[0];
      var sb = r.strongBuy || 0, b = r.buy || 0, h = r.hold || 0, s = r.sell || 0, ss = r.strongSell || 0;
      var total = sb + b + h + s + ss;
      if (total > 0) {
        var score = (sb * 5 + b * 4 + h * 3 + s * 2 + ss) / total;
        var label = score >= 4.5 ? 'Strong Buy' : score >= 3.5 ? 'Buy' :
                    score >= 2.5 ? 'Hold' : score >= 1.5 ? 'Sell' : 'Strong Sell';
        var d = new Date(String(r.period).slice(0, 10) + 'T00:00:00');
        var segs = [
          ['Strong buy', sb, '#15803d'], ['Buy', b, '#4ade80'], ['Hold', h, '#a8a29e'],
          ['Sell', s, '#f87171'], ['Strong sell', ss, '#DA121A']
        ];
        var bar = '', legend = '';
        segs.forEach(function (g) {
          bar += '<span class="rec-seg" style="width:' + (g[1] / total * 100).toFixed(1) +
                 '%;background:' + g[2] + '" title="' + g[0] + ': ' + g[1] + '"></span>';
          legend += '<span><i style="background:' + g[2] + '"></i>' + g[0] + ' ' + g[1] + '</span>';
        });
        html += '<div class="est-block">' + blockHead('Analyst consensus',
          months[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + total + ' analysts') +
          '<div class="rec-score">' + label + ' <span class="rec-score-num">' + score.toFixed(2) + ' / 5</span></div>' +
          '<div class="rec-bar">' + bar + '</div><div class="rec-legend">' + legend + '</div></div>';
      }
    }

    if (earn && earn.length) {
      // Revenue actuals come from Finnhub's as-reported quarterly financials
      // (revenue estimates for past quarters are a premium-only endpoint, so no
      // estimate/surprise columns — actuals only). Matched to EPS rows by quarter end date.
      var REV_CONCEPTS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
        'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense'];
      var finList = (finData && finData.data) || [];
      function revenueFor(periodIso) {
        if (!periodIso) return null;
        var target = new Date(periodIso + 'T00:00:00').getTime();
        var best = null, bestDiff = 20 * 864e5; // within 20 days
        finList.forEach(function (f) {
          if (!f || !f.endDate || !f.report || !f.report.ic) return;
          var diff = Math.abs(new Date(f.endDate + 'T00:00:00').getTime() - target);
          if (diff > bestDiff) return;
          for (var i = 0; i < f.report.ic.length; i++) {
            var item = f.report.ic[i];
            if (item && REV_CONCEPTS.indexOf(item.concept) !== -1 && item.value != null) {
              best = item.value; bestDiff = diff; break;
            }
          }
        });
        return best;
      }
      // Next upcoming earnings from the calendar feed (future window), with estimates.
      var nextEarn = null;
      ((calData && calData.earningsCalendar) || []).forEach(function (c) {
        if (c && c.date && (!nextEarn || c.date < nextEarn.date)) nextEarn = c;
      });
      var nextHtml = '';
      if (nextEarn) {
        var nd = nextEarn.date.split('-');
        nextHtml = 'Next earnings: <strong>' + months[parseInt(nd[1], 10) - 1] + ' ' +
                   parseInt(nd[2], 10) + ', ' + nd[0] + '</strong>';
        if (nextEarn.epsEstimate != null) nextHtml += ' · Est. EPS $' + Number(nextEarn.epsEstimate).toFixed(2);
        if (nextEarn.revenueEstimate != null) nextHtml += ' · Est. Rev ' + fmtMoney(nextEarn.revenueEstimate);
      }
      var rows4 = earn.slice(0, 4);
      var showRev = rows4.some(function (e) { return revenueFor(e.period) != null; });
      var rows = '';
      rows4.forEach(function (e) {
        var sp = e.surprisePercent;
        var spTxt = (sp == null || isNaN(sp)) ? '—' : (sp >= 0 ? '+' : '−') + Math.abs(sp).toFixed(2) + '%';
        var cls = (sp == null || isNaN(sp)) ? '' : (sp >= 0 ? 'up' : 'down');
        var est = (e.estimate == null) ? '—' : '$' + Number(e.estimate).toFixed(2);
        var act = (e.actual == null || e.actual === 0) ? '—' : '$' + Number(e.actual).toFixed(2);
        var cells = '<tr><td>Q' + e.quarter + ' ' + e.year + '</td><td>' + est + '</td><td>' + act +
                '</td><td class="' + cls + '">' + spTxt + '</td>';
        if (showRev) cells += '<td>' + fmtMoney(revenueFor(e.period)) + '</td>';
        rows += cells + '</tr>';
      });
      var head = '<tr><th>Quarter</th><th>Est. EPS</th><th>Actual EPS</th><th>EPS Surprise</th>' +
        (showRev ? '<th>Revenue</th>' : '') + '</tr>';
      html += '<div class="est-block">' + blockHead('Earnings surprises',
        showRev ? 'EPS vs estimates · revenue actuals' : 'EPS estimate vs actual') +
        (nextHtml ? '<div class="next-earn">' + nextHtml + '</div>' : '') +
        '<div class="earn-table-wrap"><table class="earn-table"><thead>' + head + '</thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
    }

    if (html) { box.innerHTML = html; box.hidden = false; }
  }

  /* ---------- company news ---------- */

  function loadNews(sym) {
    var box = $('q-news');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    // Finnhub /company-news is free; last 7 days of headlines.
    // If the worker predates the news route, this fails quietly and the block stays hidden.
    var now = new Date(), from = new Date();
    from.setDate(from.getDate() - 7);
    function iso(d) { return d.toISOString().slice(0, 10); }
    api('news', { from: iso(from), to: iso(now) }).then(function (list) {
      if (currentSymbol !== sym || !list || !list.length) return;
      var items = list.slice(0, 8);
      var html = '';
      items.forEach(function (n) {
        var d = new Date((n.datetime || 0) * 1000);
        var date = (d.getMonth() + 1) + '/' + d.getDate();
        html += '<a class="news-item" href="' + (n.url || '#') + '" target="_blank" rel="noopener">' +
                '<span class="news-head">' + esc(n.headline || '') + '</span>' +
                '<span class="news-meta">' + esc(n.source || '') + ' · ' + date + '</span></a>';
      });
      box.innerHTML = blockHead('Latest news', 'past 7 days') + html;
      box.hidden = false;
    }).catch(function () { /* no news route / no data — block stays hidden */ });
  }

  function loadFilings(sym) {
    allFilings = [];
    filingsList.innerHTML = '<div class="filings-empty">Loading filings…</div>';
    var tabs = document.querySelectorAll('.filing-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-form') === 'ALL');
    }
    fetch(WORKER_URL + '/sec/filings?symbol=' + encodeURIComponent(sym))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        allFilings = (d && d.filings) || [];
        renderFilings('ALL');
      })
      .catch(function () {
        filingsList.innerHTML = '<div class="filings-empty">Could not load filings.</div>';
      });
  }

  var filingTabs = document.querySelectorAll('.filing-tab');
  for (var ft = 0; ft < filingTabs.length; ft++) {
    filingTabs[ft].addEventListener('click', function () {
      for (var i = 0; i < filingTabs.length; i++) filingTabs[i].classList.remove('active');
      this.classList.add('active');
      renderFilings(this.getAttribute('data-form'));
    });
  }

  var tabs = document.querySelectorAll('.stocks-tabs [data-range]');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function () {
      if (currentSymbol) loadChart(this.getAttribute('data-range'));
    });
  }
  $('custom-apply').addEventListener('click', function () {
    if (!currentSymbol) return;
    var f = $('custom-from').value, te = $('custom-to').value;
    if (!f || !te) return;
    var from = Math.floor(new Date(f + 'T00:00:00') / 1000);
    var to = Math.floor(new Date(te + 'T00:00:00') / 1000) + 86399;
    if (!(to > from)) return;
    loadChart('CUSTOM', from, to);
  });

  /* chart type toggle (Line | Candles) */
  var typeBtns = document.querySelectorAll('#chart-type-toggle [data-chart-type]');
  for (var ty = 0; ty < typeBtns.length; ty++) {
    typeBtns[ty].addEventListener('click', function () {
      chartType = this.getAttribute('data-chart-type');
      updateTypeToggle();
      clearPriceLines();
      addPrevCloseLine();
      refreshSeriesVisibility();
    });
  }
  var chips = document.querySelectorAll('.stocks-chips [data-sym]');
  for (var c = 0; c < chips.length; c++) {
    chips[c].addEventListener('click', function () {
      searchInput.value = this.getAttribute('data-sym');
      search(this.getAttribute('data-sym'));
    });
  }
  goBtn.addEventListener('click', function () { search(searchInput.value); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') search(searchInput.value);
  });

  if (!WORKER_URL) setupBox.hidden = false;
})();
