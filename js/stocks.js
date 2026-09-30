/* Stocks page — live US quotes via the Cloudflare Worker proxy (Finnhub).
   Set WORKER_URL to your deployed worker URL, e.g. "https://stocks-quotes.<you>.workers.dev" */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev'; // <-- paste your worker URL here (no trailing slash)

  var $ = function (id) { return document.getElementById(id); };
  var searchInput = $('stocks-search'), goBtn = $('stocks-go');
  var setupBox = $('stocks-setup'), errorBox = $('stocks-error'), card = $('stocks-card');
  var canvas = $('stocks-chart'), tip = $('stocks-tip');
  var ctx = canvas.getContext('2d');

  var currentSymbol = '', chartData = null, chartRange = '1D', prevClose = null;

  var RANGES = {
    '1D': { resolution: '15', seconds: 86400 },
    '1W': { resolution: '30', seconds: 7 * 86400 },
    '1M': { resolution: 'D', seconds: 30 * 86400 },
    '1Y': { resolution: 'W', seconds: 365 * 86400 }
  };

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
      stat('P/E (TTM)', fmtNum(m.peBasicExclExtraTTM)) +
      stat('52-week high', fmtPrice(m['52WeekHigh'])) +
      stat('52-week low', fmtPrice(m['52WeekLow'])) +
      stat('Beta', fmtNum(m.beta)) +
      stat('Dividend yield', m.dividendYieldIndicatedAnnual != null ?
        (m.dividendYieldIndicatedAnnual * 100).toFixed(2) + '%' : '—');
    if (profile.finnhubIndustry) html += stat('Industry', profile.finnhubIndustry);
    $('q-stats').innerHTML = html;
  }

  /* ---------- chart ---------- */

  function loadChart(range) {
    chartRange = range;
    var tabs = document.querySelectorAll('.stocks-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-range') === range);
    }
    var cfg = RANGES[range];
    var now = Math.floor(Date.now() / 1000);
    api('candle', { resolution: cfg.resolution, from: now - cfg.seconds, to: now })
      .then(function (d) {
        if (!d || d.s !== 'ok' || !d.c || !d.c.length) throw new Error('no chart data');
        chartData = d;
        drawChart();
      })
      .catch(function () { chartData = null; drawChart(true); });
  }

  function xLabel(t) {
    var d = new Date(t * 1000);
    if (chartRange === '1D') {
      var h = d.getHours(), ap = h >= 12 ? 'p' : 'a';
      h = h % 12 || 12;
      return h + ap;
    }
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  function drawChart(empty, hoverIdx) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var padL = 8, padR = 64, padT = 14, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;

    var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches &&
        document.documentElement.getAttribute('data-theme') !== 'light');

    function cssVar(name, fallback) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    }
    var accent = cssVar('--color-accent', '#2563eb');
    var muted = cssVar('--color-text-muted', '#64748b');
    var gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';

    if (empty || !chartData) {
      ctx.fillStyle = muted;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(empty ? 'Chart unavailable' : 'Loading…', w / 2, h / 2);
      return;
    }

    var closes = chartData.c, times = chartData.t;
    var n = closes.length;
    var lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
    if (chartRange === '1D' && prevClose) { lo = Math.min(lo, prevClose); hi = Math.max(hi, prevClose); }
    var pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;

    var X = function (i) { return padL + (n === 1 ? iw / 2 : i / (n - 1) * iw); };
    var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * ih; };

    // gridlines + y labels
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    for (var g = 0; g <= 4; g++) {
      var gv = lo + (hi - lo) * g / 4, gy = Y(gv);
      ctx.strokeStyle = gridColor;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText('$' + gv.toFixed(gv < 10 ? 2 : 0), w - padR + 8, gy + 4);
    }
    // x labels
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.floor(n / 5));
    for (var xi = 0; xi < n; xi += step) {
      ctx.fillStyle = muted;
      ctx.fillText(xLabel(times[xi]), X(xi), h - 8);
    }

    var up = closes[n - 1] >= closes[0];
    var lineColor = up ? '#16a34a' : '#dc2626';
    if (dark) lineColor = up ? '#4ade80' : '#f87171';

    // prev-close dashed line on 1D
    if (chartRange === '1D' && prevClose) {
      ctx.strokeStyle = muted;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(padL, Y(prevClose)); ctx.lineTo(w - padR, Y(prevClose)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted; ctx.textAlign = 'left';
      ctx.fillText('prev ' + fmtPrice(prevClose), w - padR + 8, Y(prevClose) + 4);
    }

    // area fill
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, up ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(X(0), Y(closes[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(X(i), Y(closes[i]));
    ctx.lineTo(X(n - 1), padT + ih); ctx.lineTo(X(0), padT + ih); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(X(0), Y(closes[0]));
    for (var j = 1; j < n; j++) ctx.lineTo(X(j), Y(closes[j]));
    ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // last point
    ctx.beginPath();
    ctx.arc(X(n - 1), Y(closes[n - 1]), 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(X(n - 1), Y(closes[n - 1]), 1.8, 0, Math.PI * 2); ctx.fill();

    // hover crosshair
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
      var hx = X(hoverIdx), hy = Y(closes[hoverIdx]);
      ctx.strokeStyle = muted; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + ih); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fillStyle = lineColor; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(hx, 70), w - 70) + 'px';
      tip.style.top = (hy + padT) + 'px';
      tip.innerHTML = '<strong>' + fmtPrice(closes[hoverIdx]) + '</strong><br>' + xLabel(times[hoverIdx]);
    } else {
      tip.hidden = true;
    }
    canvas._geom = { X: X, n: n, padL: padL, iw: iw };
  }

  canvas.addEventListener('mousemove', function (e) {
    if (!chartData || !canvas._geom) return;
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var g = canvas._geom;
    var idx = Math.round((mx - g.padL) / g.iw * (g.n - 1));
    idx = Math.max(0, Math.min(g.n - 1, idx));
    drawChart(false, idx);
  });
  canvas.addEventListener('mouseleave', function () { drawChart(false, null); });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (chartData) drawChart(); }, 150);
  });

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

  var tabs = document.querySelectorAll('.stocks-tab');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function () {
      if (currentSymbol) loadChart(this.getAttribute('data-range'));
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
