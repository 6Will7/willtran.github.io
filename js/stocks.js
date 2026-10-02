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
    if (overlaySymbol === sym) clearOverlay(); // overlay can't be the main symbol
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
      loadFinancials(sym);
      loadNews(sym);
      loadInsider(sym);
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
    // Quote timestamp: Finnhub's t is the price time (unix seconds).
    // Makes it obvious when you're looking at a closed market / stale quote.
    var asof = $('q-asof');
    if (q.t) {
      var qt = new Date(q.t * 1000);
      asof.textContent = 'as of ' + new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(qt) + ' ET';
    } else { asof.textContent = ''; }

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

  /* ---------- chart timezone: US Eastern (market time) ---------- */
  // Lightweight Charts formats timestamps as UTC with no timezone option, so
  // intraday bars are shifted so the UTC labels read as US Eastern wall time.
  // Daily+ bars sit at 00:00 UTC (the date is unaffected) and are left alone.
  var ET_TZ = 'America/New_York';
  var etFmt = null;
  function etShift(ts) {
    try {
      if (!etFmt) {
        etFmt = new Intl.DateTimeFormat('en-US', {
          timeZone: ET_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        });
      }
      var parts = etFmt.formatToParts(new Date(ts * 1000));
      var v = {};
      for (var i = 0; i < parts.length; i++) v[parts[i].type] = parseInt(parts[i].value, 10);
      return Math.floor(Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) / 1000);
    } catch (e) { return ts; }
  }
  function shiftIntraday(d, range) {
    if (!d || !d.t || !d.t.length) return d;
    var intraday = range === '1D' || range === '1W' ||
      (range === 'CUSTOM' && (d.t[d.t.length - 1] - d.t[0]) <= 7 * 86400);
    if (!intraday) return d;
    d.t = d.t.map(etShift);
    return d;
  }

  /* ---------- overlay: a second ticker drawn on top of the main chart ---------- */

  var OVERLAY_COLOR = '#8b5cf6';
  var overlaySymbol = null, overlaySeries = null, overlayData = null;
  var customFromTs = null, customToTs = null; // remembered for overlay refetch

  function getOverlaySeries() {
    if (overlaySeries || !lwChart) return overlaySeries;
    overlaySeries = lwChart.addLineSeries({
      priceScaleId: 'overlay', // own axis (left) so different price levels stay honest
      color: OVERLAY_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      visible: false
    });
    lwChart.priceScale('overlay').applyOptions({
      position: 'left',
      borderColor: chartPalette().border
    });
    return overlaySeries;
  }

  function chartUrlFor(sym, range) {
    var url = WORKER_URL + '/chart?symbol=' + encodeURIComponent(sym) + '&range=' + range;
    if (range === 'CUSTOM' && customFromTs && customToTs) {
      url += '&from=' + customFromTs + '&to=' + customToTs;
    }
    return url;
  }

  function drawOverlay() {
    var s = getOverlaySeries();
    if (!s) return;
    if (!overlayData || !overlayData.c || !overlayData.c.length) {
      s.setData([]);
      s.applyOptions({ visible: false });
      return;
    }
    var pts = [];
    for (var i = 0; i < overlayData.t.length; i++) {
      pts.push({ time: overlayData.t[i], value: overlayData.c[i] });
    }
    s.setData(pts);
    s.applyOptions({ visible: true });
  }

  function updateOverlayChip() {
    var chip = $('overlay-chip');
    if (!chip) return;
    if (overlaySymbol) {
      chip.hidden = false;
      chip.innerHTML = '<i></i>' + overlaySymbol + ' <span aria-hidden="true">×</span>';
      chip.title = 'Remove ' + overlaySymbol + ' overlay';
    } else {
      chip.hidden = true;
      chip.innerHTML = '';
    }
  }

  function clearOverlay() {
    overlaySymbol = null;
    overlayData = null;
    if (overlaySeries) {
      overlaySeries.setData([]);
      overlaySeries.applyOptions({ visible: false });
    }
    updateOverlayChip();
  }

  function loadOverlay(sym) {
    sym = (sym || '').trim().toUpperCase();
    var input = $('overlay-input');
    if (!sym || sym === currentSymbol) return;
    overlaySymbol = sym;
    updateOverlayChip();
    fetch(chartUrlFor(sym, chartRange))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (sym !== overlaySymbol) return; // superseded
        if (!d || !d.c || !d.c.length) throw new Error('no data');
        overlayData = shiftIntraday(d, chartRange);
        drawOverlay();
      })
      .catch(function () {
        if (sym !== overlaySymbol) return;
        clearOverlay();
        if (input) {
          input.value = '';
          input.placeholder = 'No chart data for ' + sym;
          setTimeout(function () { input.placeholder = 'Overlay ticker…'; }, 2500);
        }
      });
  }

  function loadChart(range, from, to) {
    chartRange = range;
    customFromTs = (range === 'CUSTOM' && from) ? from : null;
    customToTs = (range === 'CUSTOM' && to) ? to : null;
    var tabs = document.querySelectorAll('.stocks-tabs [data-range]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-range') === range);
    }
    rangeChangeEl.textContent = '';
    rangeChangeEl.className = 'range-change';
    var url = chartUrlFor(currentSymbol, range);
    // Price charts come from Yahoo Finance via the worker (Finnhub free tier blocks candles)
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.c || !d.c.length) throw new Error('no chart data');
        chartData = shiftIntraday(d, range);
        extending = false;
        atDataStart = false; // fresh range — earlier history may exist again
        drawChart();
        updateRangeChange();
        if (overlaySymbol) loadOverlay(overlaySymbol); // keep overlay in sync with range
      })
      .catch(function () { chartData = null; rangeChangeEl.textContent = ''; drawChart(true); });
  }

  function updateRangeChange() {
    if (!chartData || chartData.c.length < 2) { rangeChangeEl.textContent = ''; return; }
    // % is computed over the visible window, so dragging/zooming the chart
    // updates the timeframe it describes.
    var n = chartData.c.length, from = 0, to = n - 1, full = true;
    if (lwChart) {
      try {
        var vr = lwChart.timeScale().getVisibleLogicalRange();
        if (vr) {
          var vf = Math.max(0, Math.floor(vr.from));
          var vt = Math.min(n - 1, Math.ceil(vr.to) - 1);
          if (vt > vf) {
            from = vf; to = vt;
            full = (vf <= 0 && vt >= n - 1);
          }
        }
      } catch (e) {}
    }
    var first = chartData.c[from], last = chartData.c[to];
    if (!first) { rangeChangeEl.textContent = ''; return; }
    var pct = (last - first) / first * 100;
    var rangeLabels = {
      '1D': 'today', '1W': 'past week', '1M': 'past month', 'YTD': 'YTD',
      '1Y': 'past year', '3Y': 'past 3 yrs', '5Y': 'past 5 yrs',
      '10Y': 'past 10 yrs', 'MAX': 'all time', 'CUSTOM': 'selected range'
    };
    var label = full ? (rangeLabels[chartRange] || 'selected range') : 'visible range';
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
      localization: { locale: 'en-US' },
      // drag to pan through time, pinch/wheel to zoom the visible window
      handleScroll: {
        mouse: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true
      },
      handleScale: {
        mouse: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true }
      }
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
    // keep the % label in sync with the visible window as the user pans/zooms,
    // load earlier history when they pan past the left edge, and mirror the
    // view into any indicator panes
    lwChart.timeScale().subscribeVisibleLogicalRangeChange(function () {
      updateRangeChange();
      maybeExtendLeft();
      syncIndCharts();
    });
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
    if (overlaySeries) {
      try { lwChart.priceScale('overlay').applyOptions({ borderColor: p.border }); } catch (e) {}
    }
    // re-theme indicator panes (MACD histogram colors depend on the palette)
    Object.keys(indPanes).forEach(function (k) {
      var pane = indPanes[k];
      try {
        pane.chart.applyOptions({
          layout: { background: { type: 'solid', color: p.bg }, textColor: p.text },
          grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
          crosshair: {
            vertLine: { color: p.crosshair, labelBackgroundColor: p.crosshair },
            horzLine: { color: p.crosshair, labelBackgroundColor: p.crosshair }
          },
          rightPriceScale: { borderColor: p.border },
          timeScale: { borderColor: p.border }
        });
      } catch (e) {}
    });
    refreshIndicators();
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
      clearIndicatorData();
      lwMsg.hidden = false;
      if (empty) { lwMsg.textContent = 'Chart unavailable'; }
      else { lwMsg.innerHTML = '<div class="loader-center"><div class="spinner spinner-sm" role="status" aria-label="Loading chart"></div></div>'; }
      return;
    }
    lwMsg.hidden = true;
    paintSeries();
    setMainSeriesData();
    refreshIndicators();
    updateTypeToggle();
    addPrevCloseLine();
    refreshSeriesVisibility();
    lwChart.timeScale().fitContent();
  }

  function setMainSeriesData() {
    if (!lwChart || !chartData) return;
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
  }

  // Same-window prepend for the overlay, so its bar interval matches the main chart's.
  function extendOverlay(fromTs, toTs) {
    if (!overlaySymbol || !overlayData || !overlayData.t || !overlayData.t.length) return;
    fetch(WORKER_URL + '/chart?symbol=' + encodeURIComponent(overlaySymbol) +
      '&from=' + fromTs + '&to=' + toTs)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.c || d.c.length < 2) return;
        d = shiftIntraday(d, chartRange);
        var first = overlayData.t[0], pt = [], pc = [];
        for (var i = 0; i < d.t.length; i++) {
          if (d.t[i] < first) { pt.push(d.t[i]); pc.push(d.c[i]); }
        }
        if (pt.length < 2) return;
        overlayData.t = pt.concat(overlayData.t);
        overlayData.c = pc.concat(overlayData.c);
        drawOverlay();
      })
      .catch(function () {});
  }

  /* ---------- technical indicators ---------- */

  var INDICATORS = {
    ema20: { on: false }, ema50: { on: false }, ema200: { on: false },
    rsi: { on: false }, macd: { on: false }, obv: { on: false }
  };
  var EMA_DEFS = {
    ema20: { p: 20, color: '#38bdf8' },
    ema50: { p: 50, color: '#fb923c' },
    ema200: { p: 200, color: '#f472b6' }
  };
  var PANE_DEFS = {
    rsi: { title: 'RSI (14)', height: 120 },
    macd: { title: 'MACD (12, 26, 9)', height: 140 },
    obv: { title: 'On-Balance Volume', height: 110 }
  };
  var PANE_ORDER = ['rsi', 'macd', 'obv'];
  var emaSeries = {}; // ema20/50/200 -> line series on the main chart
  var indPanes = {}; // rsi/macd/obv -> { wrap, chart, ...series }

  function ema(values, period) {
    var out = new Array(values.length).fill(null);
    if (values.length < 2 || period < 1) return out;
    var seedN = Math.min(period, values.length); // seed with what's available on short ranges
    var k = 2 / (period + 1), sum = 0, i;
    for (i = 0; i < seedN; i++) sum += values[i];
    var prev = sum / seedN; // seed with SMA
    out[seedN - 1] = prev;
    for (i = seedN; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsi(values, period) {
    var out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    var gain = 0, loss = 0, i, ch;
    for (i = 1; i <= period; i++) {
      ch = values[i] - values[i - 1];
      if (ch > 0) gain += ch; else loss -= ch;
    }
    var ag = gain / period, al = loss / period;
    out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (i = period + 1; i < values.length; i++) {
      ch = values[i] - values[i - 1];
      ag = (ag * (period - 1) + Math.max(ch, 0)) / period;
      al = (al * (period - 1) + Math.max(-ch, 0)) / period;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  function obv(closes, vols) {
    var out = new Array(closes.length), v = 0, i;
    for (i = 0; i < closes.length; i++) {
      if (i > 0) {
        if (closes[i] > closes[i - 1]) v += vols[i] || 0;
        else if (closes[i] < closes[i - 1]) v -= vols[i] || 0;
      }
      out[i] = v;
    }
    return out;
  }

  function macd(values) {
    var ef = ema(values, 12), es = ema(values, 26);
    var line = new Array(values.length).fill(null);
    var sig = new Array(values.length).fill(null);
    var start = -1, i;
    for (i = 0; i < values.length; i++) {
      if (ef[i] != null && es[i] != null) {
        line[i] = ef[i] - es[i];
        if (start < 0) start = i;
      }
    }
    if (start < 0) return { line: line, signal: sig };
    var compact = line.slice(start);
    var eSig = ema(compact, 9);
    for (i = 0; i < compact.length; i++) {
      if (eSig[i] != null) sig[start + i] = eSig[i];
    }
    return { line: line, signal: sig };
  }

  function fillEmas() {
    if (!lwChart || !chartData || !chartData.c) return;
    var closes = chartData.c, n = closes.length;
    Object.keys(EMA_DEFS).forEach(function (key) {
      var s = emaSeries[key];
      if (!INDICATORS[key].on) {
        if (s) s.applyOptions({ visible: false });
        return;
      }
      if (!s) {
        s = lwChart.addLineSeries({
          color: EMA_DEFS[key].color, lineWidth: 1,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false
        });
        emaSeries[key] = s;
      }
      var e = ema(closes, EMA_DEFS[key].p), pts = [];
      for (var i = 0; i < n; i++) {
        if (e[i] != null) pts.push({ time: chartData.t[i], value: e[i] });
      }
      s.setData(pts);
      s.applyOptions({ visible: true });
    });
  }

  function ensureIndPane(key) {
    if (indPanes[key] || typeof LightweightCharts === 'undefined') return indPanes[key] || null;
    var def = PANE_DEFS[key];
    var p = chartPalette();
    var wrap = document.createElement('div');
    wrap.className = 'ind-pane';
    var title = document.createElement('div');
    title.className = 'ind-pane-title';
    title.textContent = def.title;
    var el = document.createElement('div');
    el.className = 'ind-pane-chart';
    el.style.height = def.height + 'px';
    wrap.appendChild(title);
    wrap.appendChild(el);
    $('indicator-panes').appendChild(wrap);
    var ch = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: def.height,
      layout: {
        background: { type: 'solid', color: p.bg },
        textColor: p.text,
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: p.crosshair, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: p.crosshair },
        horzLine: { color: p.crosshair, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: p.crosshair }
      },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false },
      handleScroll: false, // panes mirror the main chart; all panning happens there
      handleScale: false
    });
    var pane = { wrap: wrap, el: el, chart: ch };
    if (key === 'rsi') {
      pane.rsi = ch.addLineSeries({
        color: '#2dd4bf', lineWidth: 2,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true
      });
      [70, 30].forEach(function (lv) {
        pane.rsi.createPriceLine({
          price: lv, color: p.text, lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true, title: ''
        });
      });
    } else if (key === 'macd') {
      pane.macdHist = ch.addHistogramSeries({ lastValueVisible: false, priceLineVisible: false });
      pane.macdLine = ch.addLineSeries({
        color: '#38bdf8', lineWidth: 2,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true
      });
      pane.macdSig = ch.addLineSeries({
        color: '#fb923c', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false
      });
    } else if (key === 'obv') {
      pane.obv = ch.addLineSeries({
        color: '#4ade80', lineWidth: 2,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true
      });
    }
    indPanes[key] = pane;
    layoutIndPanes();
    return pane;
  }

  function destroyIndPane(key) {
    var pane = indPanes[key];
    if (!pane) return;
    try { pane.chart.remove(); } catch (e) {}
    if (pane.wrap.parentNode) pane.wrap.parentNode.removeChild(pane.wrap);
    delete indPanes[key];
    layoutIndPanes();
  }

  function layoutIndPanes() {
    // fixed visual order + time axis only on the bottom pane
    var holder = $('indicator-panes');
    var keys = PANE_ORDER.filter(function (k) { return indPanes[k]; });
    keys.forEach(function (k) { holder.appendChild(indPanes[k].wrap); });
    keys.forEach(function (k, i) {
      try { indPanes[k].chart.applyOptions({ timeScale: { visible: i === keys.length - 1 } }); }
      catch (e) {}
    });
    // keep pane widths in step with the main chart
    keys.forEach(function (k) {
      try { indPanes[k].chart.applyOptions({ width: indPanes[k].el.clientWidth }); }
      catch (e) {}
    });
  }

  function fillIndPanes() {
    var keys = Object.keys(indPanes);
    if (!keys.length) return;
    if (!chartData || !chartData.c || !chartData.c.length) {
      keys.forEach(function (k) {
        var pane = indPanes[k];
        ['rsi', 'macdLine', 'macdSig', 'macdHist', 'obv'].forEach(function (sn) {
          if (pane[sn]) { try { pane[sn].setData([]); } catch (e) {} }
        });
      });
      return;
    }
    var closes = chartData.c, n = closes.length, i;
    var p = chartPalette();
    keys.forEach(function (k) {
      var pane = indPanes[k];
      if (k === 'rsi') {
        var r = rsi(closes, 14), pts = [];
        for (i = 0; i < n; i++) {
          if (r[i] != null) pts.push({ time: chartData.t[i], value: r[i] });
        }
        pane.rsi.setData(pts);
      } else if (k === 'macd') {
        var m = macd(closes), ml = [], sg = [], hg = [];
        for (i = 0; i < n; i++) {
          if (m.line[i] == null) continue;
          ml.push({ time: chartData.t[i], value: m.line[i] });
          if (m.signal[i] != null) {
            sg.push({ time: chartData.t[i], value: m.signal[i] });
            var hv = m.line[i] - m.signal[i];
            hg.push({
              time: chartData.t[i], value: hv,
              color: hv >= 0 ? hexA(p.up, 0.55) : hexA(p.down, 0.55)
            });
          }
        }
        pane.macdLine.setData(ml);
        pane.macdSig.setData(sg);
        pane.macdHist.setData(hg);
      } else if (k === 'obv') {
        var o = obv(closes, chartData.v), pts2 = [];
        for (i = 0; i < n; i++) pts2.push({ time: chartData.t[i], value: o[i] });
        pane.obv.setData(pts2);
      }
    });
  }

  function refreshIndicators() {
    fillEmas();
    fillIndPanes();
  }

  function clearIndicatorData() {
    Object.keys(emaSeries).forEach(function (k) {
      try { emaSeries[k].setData([]); } catch (e) {}
    });
    fillIndPanes(); // empties pane series when there is no chart data
  }

  // Mirror the main chart's visible window into the indicator panes.
  function syncIndCharts() {
    if (!lwChart) return;
    var vr = null;
    try { vr = lwChart.timeScale().getVisibleLogicalRange(); } catch (e) {}
    if (!vr) return;
    Object.keys(indPanes).forEach(function (k) {
      try { indPanes[k].chart.timeScale().setVisibleLogicalRange(vr); } catch (e) {}
    });
  }

  function setIndicator(key, on) {
    if (!INDICATORS[key]) return;
    INDICATORS[key].on = on;
    var btns = document.querySelectorAll('[data-ind]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', !!INDICATORS[btns[i].getAttribute('data-ind')].on);
    }
    if (key.indexOf('ema') === 0) {
      if (on) { ensureChart(); fillEmas(); }
      else if (emaSeries[key]) emaSeries[key].applyOptions({ visible: false });
    } else {
      if (on) {
        if (ensureIndPane(key)) { fillIndPanes(); syncIndCharts(); }
      } else destroyIndPane(key);
    }
  }

  /* ---------- infinite scroll: load earlier history when panning left ---------- */

  var extending = false, atDataStart = false;
  var MAX_SPAN_SEC = 40 * 366 * 86400; // stop extending past ~40 years

  // Chunk size (seconds) chosen so the worker returns the same bar interval
  // as the current range — no mixed granularities on the chart.
  function extensionChunk(range, spanSec) {
    var day = 86400;
    if (range === '1D' || range === '1W') return 6 * day; // 1h bars (closest available)
    if (range === '1M' || range === 'YTD' || range === '1Y') return 100 * day; // 1d bars
    if (range === '3Y' || range === '5Y') return Math.floor(2.5 * 366 * day); // 1wk bars
    if (range === '10Y') return Math.floor(2.5 * 366 * day); // 1wk bars, matches main
    if (range === 'MAX') return 10 * 366 * day; // 1mo bars, matches main
    if (spanSec <= 7 * day) return 6 * day;
    if (spanSec <= 120 * day) return 100 * day;
    if (spanSec <= 3 * 366 * day) return Math.floor(2.5 * 366 * day);
    return 10 * 366 * day; // 1mo bars
  }

  function maybeExtendLeft() {
    if (extending || atDataStart || !chartData || chartData.t.length < 2 || !lwChart) return;
    var vr = null;
    try { vr = lwChart.timeScale().getVisibleLogicalRange(); } catch (e) { return; }
    if (!vr || vr.from > 8) return; // not near the left edge yet
    var spanSec = chartData.t[chartData.t.length - 1] - chartData.t[0];
    // MAX ("all time") has no span cap — Yahoo stops at the IPO and the
    // no-new-bars check ends extension naturally
    if (chartRange !== 'MAX' && spanSec >= MAX_SPAN_SEC) { atDataStart = true; return; }
    extendLeft();
  }

  function extendLeft() {
    extending = true;
    var spanSec = chartData.t[chartData.t.length - 1] - chartData.t[0];
    var chunk = extensionChunk(chartRange, spanSec);
    var toTs = chartData.t[0] - 1; // no overlap with what we have
    var fromTs = Math.max(0, chartData.t[0] - chunk);
    var url = WORKER_URL + '/chart?symbol=' + encodeURIComponent(currentSymbol) +
      '&from=' + fromTs + '&to=' + toTs;
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        extending = false;
        d = shiftIntraday(d, chartRange);
        if (!d || !d.c || d.c.length < 2) { atDataStart = true; return; }
        var first = chartData.t[0];
        var nt = [], no = [], nh = [], nl = [], nc = [], nv = [];
        for (var i = 0; i < d.t.length; i++) {
          if (d.t[i] < first) {
            nt.push(d.t[i]); no.push(d.o[i]); nh.push(d.h[i]);
            nl.push(d.l[i]); nc.push(d.c[i]); nv.push(d.v[i]);
          }
        }
        if (nt.length < 2) { atDataStart = true; return; } // nothing new — we're at the start
        var vr = null;
        try { vr = lwChart.timeScale().getVisibleLogicalRange(); } catch (e) {}
        chartData.t = nt.concat(chartData.t);
        chartData.o = no.concat(chartData.o);
        chartData.h = nh.concat(chartData.h);
        chartData.l = nl.concat(chartData.l);
        chartData.c = nc.concat(chartData.c);
        chartData.v = nv.concat(chartData.v);
        setMainSeriesData();
        refreshIndicators(); // indicator data must be full-length before the view shifts
        // keep the view stable: shift the window right by the prepended bars
        if (vr) {
          try {
            lwChart.timeScale().setVisibleLogicalRange({
              from: vr.from + nt.length, to: vr.to + nt.length
            });
          } catch (e) {}
        }
        updateRangeChange();
        extendOverlay(fromTs, toTs);
      })
      .catch(function () { extending = false; });
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
      api('financials', { freq: 'quarterly' }).catch(function () { return null; }),
      api('financials').catch(function () { return null; }), // annual 10-Ks (Q4 revenue)
      api('analyst/eps-forecast').catch(function () { return null; }) // Nasdaq consensus EPS outlook
    ]).then(function (res) {
      if (currentSymbol === sym) renderEstimates(res[0], res[1], res[2], res[3], res[4], res[5]);
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

  // Derive discrete quarterly revenue from Finnhub's as-reported financials.
  // 10-Q figures are cumulative (Q2 covers 6 months), so: Q1 as filed,
  // Q2 = 6mo − Q1, Q3 = 9mo − Q2, Q4 = 10-K − Q3. Amendments deduped by
  // latest filed date; implausible results are dropped, never fabricated.
  function quarterlyRevenue(finData) {
    var REV_CONCEPTS = ['us-gaap_Revenues',
      'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
      'us-gaap_SalesRevenueNet', 'us-gaap_SalesRevenueGoodsNet',
      'us-gaap_RevenuesNetOfInterestExpense'];
    var byYear = {};
    ((finData && finData.data) || []).forEach(function (f) {
      if (!f || !f.startDate || !f.endDate || !f.report || !f.report.ic) return;
      var rev = null;
      for (var i = 0; i < f.report.ic.length; i++) {
        var item = f.report.ic[i];
        if (item && item.value != null && REV_CONCEPTS.indexOf(String(item.concept)) !== -1) {
          rev = item.value; break;
        }
      }
      if (rev == null) return;
      var y = String(f.startDate).slice(0, 10), e = String(f.endDate).slice(0, 10);
      var g = byYear[y] || (byYear[y] = {});
      var filed = f.filedDate || '';
      if (!g[e] || filed > g[e].filed) {
        var pd = (new Date(e + 'T00:00:00') - new Date(y + 'T00:00:00')) / 864e5;
        g[e] = { end: e, rev: rev, filed: filed, pd: pd };
      }
    });
    var out = [];
    Object.keys(byYear).forEach(function (y) {
      var reps = Object.keys(byYear[y]).map(function (e) { return byYear[y][e]; });
      reps.sort(function (a, b) { return a.end < b.end ? -1 : (a.end > b.end ? 1 : 0); });
      for (var i = 0; i < reps.length; i++) {
        var q = null;
        if (i === 0) {
          if (reps[i].pd <= 100) q = reps[i].rev; // ~3-month quarter as filed
        } else {
          q = reps[i].rev - reps[i - 1].rev;
          if (!(q > 0 && q <= reps[i].rev)) q = null;
        }
        if (q != null) out.push({ end: reps[i].end, revenue: q });
      }
    });
    out.sort(function (a, b) { return a.end < b.end ? -1 : (a.end > b.end ? 1 : 0); });
    return out;
  }

  function renderEstimates(rec, earn, calData, finQ, finA, epsOutlook) {
    // Merge quarterly 10-Qs and annual 10-Ks (Q4 only exists in the 10-K).
    var finData = { data: ((finQ && finQ.data) || []).concat((finA && finA.data) || []) };
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

    // Consensus EPS outlook: Nasdaq analyst forecasts for coming fiscal years
    // (consensus, high/low range, analyst count, implied YoY growth). Free and
    // keyless via the worker; skipped quietly if the worker predates the route.
    var yf = epsOutlook && epsOutlook.yearlyForecast;
    var yrows = (yf && yf.rows) || [];
    if (yrows.length) {
      var ybody = '';
      yrows.forEach(function (r, i) {
        var cons = r.consensusEPSForecast, prev = i > 0 ? yrows[i - 1].consensusEPSForecast : null;
        var yoy = (cons != null && prev != null && prev !== 0)
          ? ((cons / prev - 1) * 100) : null;
        var yoyTxt = yoy == null ? '—' : (yoy >= 0 ? '+' : '−') + Math.abs(yoy).toFixed(1) + '%';
        var yoyCls = yoy == null ? '' : (yoy >= 0 ? 'up' : 'down');
        ybody += '<tr><td>' + esc(String(r.fiscalEnd || '—')) + '</td>' +
          '<td><strong>' + (cons == null ? '—' : '$' + Number(cons).toFixed(2)) + '</strong></td>' +
          '<td>' + (r.highEPSForecast == null ? '—' : '$' + Number(r.highEPSForecast).toFixed(2)) + '</td>' +
          '<td>' + (r.lowEPSForecast == null ? '—' : '$' + Number(r.lowEPSForecast).toFixed(2)) + '</td>' +
          '<td>' + (r.noOfEstimates == null ? '—' : r.noOfEstimates) + '</td>' +
          '<td class="' + yoyCls + '">' + yoyTxt + '</td></tr>';
      });
      html += '<div class="est-block est-wide">' + blockHead('Consensus EPS outlook',
        'Fiscal-year analyst estimates · via Nasdaq') +
        '<div class="earn-table-wrap"><table class="earn-table"><thead><tr>' +
        '<th>Fiscal year</th><th>Consensus EPS</th><th>High</th><th>Low</th>' +
        '<th>Analysts</th><th>YoY growth</th>' +
        '</tr></thead><tbody>' + ybody + '</tbody></table></div></div>';
    }

    if (earn && earn.length) {
      // Revenue actuals come from Finnhub's as-reported quarterly financials.
      // Those figures are cumulative (10-Q Q2 covers 6 months), so discrete
      // quarters are derived: Q1 as filed, Q2 = 6mo − Q1, etc. Revenue
      // estimates for past quarters are a premium-only endpoint, so the table
      // shows actuals only. Matched to EPS rows by quarter end date.
      var qrev = quarterlyRevenue(finData);
      function revenueFor(periodIso) {
        if (!periodIso || !qrev.length) return null;
        var target = new Date(periodIso + 'T00:00:00').getTime();
        var best = null, bestDiff = 20 * 864e5; // within 20 days
        qrev.forEach(function (r) {
          var diff = Math.abs(new Date(r.end + 'T00:00:00').getTime() - target);
          if (diff < bestDiff) { best = r.revenue; bestDiff = diff; }
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

  function loadInsider(sym) {
    var box = $('q-insider');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    // Finnhub /stock/insider-transactions, last 180 days via the worker.
    // If the endpoint is premium-gated this 403s and the block stays hidden.
    api('insider').then(function (res) {
      if (currentSymbol !== sym || !res || !res.data || !res.data.length) return;
      var rows = res.data
        .filter(function (t) { return t.transactionDate; })
        .sort(function (a, b) { return b.transactionDate < a.transactionDate ? -1 : 1; })
        .slice(0, 10);
      if (!rows.length) return;
      var buys = 0, sells = 0;
      var html = '<table class="insider-table"><thead><tr>' +
        '<th>Date</th><th>Insider</th><th>Type</th>' +
        '<th class="num">Shares</th><th class="num">% of ownership</th><th class="num">Price</th></tr></thead><tbody>';
      rows.forEach(function (t) {
        var code = String(t.transactionCode || '').toUpperCase();
        var isBuy = code === 'P', isSell = code === 'S';
        if (isBuy) buys++; if (isSell) sells++;
        var shares = Math.abs(t.change || 0);
        var ownPct = (t.share > 0 && shares > 0) ? (shares / t.share * 100) : 0;
        html += '<tr><td>' + esc(t.transactionDate || '') + '</td>' +
          '<td>' + esc(t.name || '—') + '</td>' +
          '<td><span class="insider-badge ' + (isBuy ? 'buy' : isSell ? 'sell' : '') + '">' +
          (isBuy ? 'Buy' : isSell ? 'Sell' : esc(code || '—')) + '</span></td>' +
          '<td class="num">' + (shares ? shares.toLocaleString('en-US') : '—') + '</td>' +
          '<td class="num">' + (ownPct ? ownPct.toFixed(1) + '%' : '—') + '</td>' +
          '<td class="num">' + (t.transactionPrice ? '$' + Number(t.transactionPrice).toFixed(2) : '—') + '</td></tr>';
      });
      html += '</tbody></table>';
      var sub = 'last 180 days' + (buys || sells ? ' · ' + buys + ' buys, ' + sells + ' sells' : '');
      box.innerHTML = blockHead('Insider trades', sub) + html;
      box.hidden = false;
    }).catch(function () { /* premium-gated or no data — block stays hidden */ });
  }

  function loadFinancials(sym) {
    var box = $('q-financials');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    // SEC companyfacts via the worker — as-reported quarterly financials.
    api('sec/facts').then(function (res) {
      if (currentSymbol !== sym || !res || !res.quarters || !res.quarters.length) return;
      var n = res.quarters.length;      // up to 12 quarter ends
      var show = Math.min(8, n);        // display the last 8
      var off = n - show;
      function qlabel(iso) {
        var p = iso.split('-');
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return months[Number(p[1]) - 1] + " '" + p[0].slice(2);
      }
      function money(v) {
        if (v == null || isNaN(v)) return '—';
        var a = Math.abs(v);
        if (a >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
        if (a >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
        return '$' + Math.round(v).toLocaleString('en-US');
      }
      function yoy(arr, i) {
        var v = arr[off + i], p = arr[off + i - 4];
        if (v == null || p == null || p === 0) return '';
        var pct = (v - p) / Math.abs(p) * 100;
        var cls = pct > 0.05 ? 'fin-up' : pct < -0.05 ? 'fin-dn' : 'fin-flat';
        return '<div class="fin-yoy ' + cls + '">' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '% YoY</div>';
      }
      function finRow(label, arr, isEps) {
        var any = false, i, v;
        for (i = 0; i < show; i++) {
          v = arr[off + i];
          if (v != null && !isNaN(v)) { any = true; break; }
        }
        if (!any) return ''; // company doesn't report this metric — hide the row
        var html = '<tr><th>' + label + '</th>';
        for (i = 0; i < show; i++) {
          v = arr[off + i];
          var val = (v == null || isNaN(v)) ? '—' : (isEps ? '$' + Number(v).toFixed(2) : money(v));
          var latest = (i === show - 1) ? ' fin-latest' : '';
          html += '<td class="num' + latest + '"><div class="fin-val">' + val + '</div>' + yoy(arr, i) + '</td>';
        }
        return html + '<td class="spark">' + sparkline(arr, off, show) + '</td></tr>';
      }
      function sparkline(arr, off, show) {
        var pts = [];
        for (var i = 0; i < show; i++) {
          var v = arr[off + i];
          if (v != null && !isNaN(v)) pts.push({ i: i, v: v });
        }
        if (pts.length < 2) return '';
        var vs = pts.map(function (p) { return p.v; });
        var mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
        var W = 76, H = 28, pad = 3;
        var rng = (mx - mn) || 1;
        var step = (W - pad * 2) / (show - 1);
        var d = pts.map(function (p, j) {
          var x = (pad + p.i * step).toFixed(1);
          var y = (H - pad - (p.v - mn) / rng * (H - pad * 2)).toFixed(1);
          return (j ? 'L' : 'M') + x + ' ' + y;
        }).join(' ');
        var up = vs[vs.length - 1] >= vs[0];
        return '<svg class="spark-svg" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
          '<path d="' + d + '" fill="none" stroke="' + (up ? '#16a34a' : '#dc2626') +
          '" stroke-width="1.6" stroke-linecap="round"/></svg>';
      }
      var html = '<table class="fin-table"><thead><tr><th></th>';
      for (var i = 0; i < show; i++) {
        html += '<th class="num' + (i === show - 1 ? ' fin-latest' : '') + '">' + qlabel(res.quarters[off + i]) + '</th>';
      }
      html += '<th class="num spark-head">Trend</th></tr></thead><tbody>' +
        finRow('Revenue', res.revenue) +
        finRow('Gross profit', res.grossProfit) +
        finRow('Operating income', res.opIncome) +
        finRow('Net income', res.netIncome) +
        finRow('Diluted EPS', res.eps, true) +
        '</tbody></table>';
      if (html.indexOf('<tbody></tbody>') !== -1) return; // nothing reportable
      box.innerHTML = blockHead('Financials', 'as-reported quarterly · SEC companyfacts') + html;
      box.hidden = false;
    }).catch(function () { /* no SEC data — block stays hidden */ });
  }

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
    filingsList.innerHTML = '<div class="loader-center"><div class="spinner spinner-sm" role="status" aria-label="Loading filings"></div><span>Loading filings…</span></div>';
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

  /* overlay wiring */
  $('overlay-add').addEventListener('click', function () {
    loadOverlay($('overlay-input').value);
  });
  $('overlay-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadOverlay(this.value);
  });
  $('overlay-chip').addEventListener('click', function () {
    clearOverlay();
    var input = $('overlay-input');
    if (input) input.value = '';
  });

  /* indicator toggles */
  var indBtns = document.querySelectorAll('[data-ind]');
  for (var ib = 0; ib < indBtns.length; ib++) {
    indBtns[ib].addEventListener('click', function () {
      var key = this.getAttribute('data-ind');
      setIndicator(key, !INDICATORS[key].on);
    });
  }
  window.addEventListener('resize', function () {
    Object.keys(indPanes).forEach(function (k) {
      try { indPanes[k].chart.applyOptions({ width: indPanes[k].el.clientWidth }); }
      catch (e) {}
    });
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
  // Deep link: /stocks/?symbol=NVDA loads that ticker on arrival
  try {
    var qsym = new URLSearchParams(location.search).get('symbol');
    if (qsym) { searchInput.value = qsym; search(qsym); }
  } catch (e) {}

  /* ---------- watchlist with cross-device sync ----------
   * Backend: Cloudflare Worker + D1 (see workspace/stocks-worker/).
   * No passwords: this browser holds a random 128-bit account token in
   * localStorage; devices link via short-lived pairing codes. The token is
   * the ONLY thing in localStorage — the list itself lives server-side. */
  var WL_KEY = 'wt_sync_token';
  var wlToken = null, wlTickers = [], wlCodeTimer = null;
  try { wlToken = localStorage.getItem(WL_KEY); } catch (e) { wlToken = null; }

  function wlMsg(text, cls) {
    var m = $('wl-msg');
    m.textContent = text || '';
    m.className = 'wl-msg' + (cls ? ' ' + cls : '');
  }
  function wlAuthHeaders() {
    return wlToken ? { 'Authorization': 'Bearer ' + wlToken } : {};
  }
  async function wlEnsureToken() {
    if (wlToken) return wlToken;
    var r = await fetch(WORKER_URL + '/sync/new', { method: 'POST' });
    if (!r.ok) throw new Error(r.status === 501 ? 'sync is not set up yet' : 'could not reach sync server');
    var j = await r.json();
    if (!j.token) throw new Error('bad sync response');
    wlToken = j.token;
    try { localStorage.setItem(WL_KEY, wlToken); } catch (e) {}
    return wlToken;
  }
  function renderWatchlist() {
    var box = $('wl-chips');
    box.innerHTML = '';
    wlTickers.forEach(function (t) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wl-chip';
      var label = document.createElement('span');
      label.textContent = t;
      var x = document.createElement('i');
      x.textContent = '×';
      x.title = 'Remove ' + t;
      x.addEventListener('click', function (ev) { ev.stopPropagation(); wlRemove(t); });
      chip.appendChild(label);
      chip.appendChild(x);
      chip.addEventListener('click', function () { search(t); });
      box.appendChild(chip);
    });
    var addSym = $('wl-add-sym');
    if (addSym) addSym.textContent = currentSymbol || '';
    $('watchlist-bar').hidden = false;
  }
  async function wlLoad() {
    if (!wlToken || !WORKER_URL) return;
    try {
      var r = await fetch(WORKER_URL + '/sync/watchlist', { headers: wlAuthHeaders() });
      if (r.status === 401) { // token unknown server-side (fresh D1) — start over
        try { localStorage.removeItem(WL_KEY); } catch (e) {}
        wlToken = null; wlTickers = [];
        renderWatchlist();
        return;
      }
      if (!r.ok) return;
      var j = await r.json();
      wlTickers = Array.isArray(j.tickers) ? j.tickers : [];
      renderWatchlist();
    } catch (e) { /* offline — bar stays as-is */ }
  }
  async function wlSave() {
    await wlEnsureToken();
    var r = await fetch(WORKER_URL + '/sync/watchlist', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, wlAuthHeaders()),
      body: JSON.stringify({ tickers: wlTickers })
    });
    if (!r.ok) {
      var j = {}; try { j = await r.json(); } catch (e) {}
      throw new Error(j.error || ('save failed (' + r.status + ')'));
    }
  }
  async function wlAdd(sym) {
    sym = String(sym || '').toUpperCase().trim();
    if (!sym || wlTickers.indexOf(sym) !== -1) return;
    if (wlTickers.length >= 50) { wlMsg('Watchlist is full (50).', 'err'); return; }
    var prev = wlTickers.slice();
    wlTickers.push(sym);
    renderWatchlist();
    try { await wlSave(); wlMsg(''); }
    catch (e) { wlTickers = prev; renderWatchlist(); wlMsg(e.message, 'err'); }
  }
  async function wlRemove(sym) {
    var prev = wlTickers.slice();
    wlTickers = wlTickers.filter(function (t) { return t !== sym; });
    renderWatchlist();
    try { await wlSave(); }
    catch (e) { wlTickers = prev; renderWatchlist(); wlMsg(e.message, 'err'); }
  }
  function wlStopTimer() {
    if (wlCodeTimer) { clearInterval(wlCodeTimer); wlCodeTimer = null; }
  }
  $('wl-add').addEventListener('click', function () {
    if (!currentSymbol) { wlMsg('Search a ticker first, then add it.', 'err'); return; }
    wlMsg('');
    wlAdd(currentSymbol);
  });
  $('wl-sync-btn').addEventListener('click', function () {
    var p = $('wl-panel');
    p.hidden = !p.hidden;
    if (p.hidden) { wlStopTimer(); $('wl-code-out').hidden = true; }
  });
  $('wl-panel-close').addEventListener('click', function () {
    $('wl-panel').hidden = true;
    wlStopTimer();
    $('wl-code-out').hidden = true;
  });
  $('wl-gen-code').addEventListener('click', async function () {
    wlMsg('');
    try {
      await wlEnsureToken();
      var r = await fetch(WORKER_URL + '/sync/pair-code', { method: 'POST', headers: wlAuthHeaders() });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || ('failed (' + r.status + ')'));
      $('wl-code-val').textContent = j.code;
      $('wl-code-out').hidden = false;
      wlStopTimer();
      var left = j.expires_in || 600;
      var tick = function () {
        var m = Math.floor(left / 60), s = left % 60;
        $('wl-code-timer').textContent = 'expires in ' + m + ':' + (s < 10 ? '0' : '') + s;
        if (left <= 0) {
          wlStopTimer();
          $('wl-code-out').hidden = true;
          wlMsg('Code expired — get a new one.', 'err');
        }
        left--;
      };
      tick();
      wlCodeTimer = setInterval(tick, 1000);
      wlMsg('Enter this code on your other device.', 'ok');
    } catch (e) { wlMsg(e.message, 'err'); }
  });
  $('wl-redeem').addEventListener('click', async function () {    var code = $('wl-code-in').value;
    if (!code.trim()) { wlMsg('Enter the code first.', 'err'); return; }
    wlMsg('Pairing…');
    var hadLocal = wlTickers.slice(); // merge, don't clobber, if this device had its own list
    try {
      var r = await fetch(WORKER_URL + '/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || ('failed (' + r.status + ')'));
      wlToken = j.token;
      try { localStorage.setItem(WL_KEY, wlToken); } catch (e) {}
      await wlLoad();
      var merged = wlTickers.slice();
      hadLocal.forEach(function (t) { if (merged.indexOf(t) === -1 && merged.length < 50) merged.push(t); });
      if (merged.length !== wlTickers.length) {
        wlTickers = merged;
        renderWatchlist();
        try { await wlSave(); } catch (e2) {}
      }
      $('wl-code-in').value = '';
      wlMsg('Paired — this device now shares the watchlist.', 'ok');
    } catch (e) { wlMsg(e.message, 'err'); }
  });
  $('wl-gen-recovery').addEventListener('click', async function () {
    wlMsg('');
    try {
      await wlEnsureToken();
      var r = await fetch(WORKER_URL + '/sync/recovery-code', { method: 'POST', headers: wlAuthHeaders() });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || ('failed (' + r.status + ')'));
      $('wl-recovery-val').textContent = j.code;
      $('wl-recovery-out').hidden = false;
      wlMsg('Save this somewhere safe — it replaces any previous recovery code.', 'ok');
    } catch (e) { wlMsg(e.message, 'err'); }
  });
  $('wl-custom-set').addEventListener('click', async function () {
    wlMsg('');
    var code = $('wl-custom-in').value;
    if (code.trim().length < 12) { wlMsg('Use at least 12 characters.', 'err'); return; }
    try {
      await wlEnsureToken();
      var h = wlAuthHeaders(); h['Content-Type'] = 'application/json';
      var r = await fetch(WORKER_URL + '/sync/recovery-custom', {
        method: 'POST', headers: h, body: JSON.stringify({ code: code })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.error || ('failed (' + r.status + ')'));
      $('wl-custom-in').value = '';
      wlMsg('Custom code set — it replaced any previous recovery code.', 'ok');
    } catch (e) { wlMsg(e.message, 'err'); }
  });

  if (WORKER_URL) { renderWatchlist(); wlLoad(); }

  if (!WORKER_URL) setupBox.hidden = false;
})();
