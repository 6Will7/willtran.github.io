/* Correlation Calculator — two tickers, correlation across timeframes. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';

  var form = document.getElementById('corr-form');
  var aEl = document.getElementById('corr-a');
  var bEl = document.getElementById('corr-b');
  var resultsEl = document.getElementById('corr-results');
  var summaryEl = document.getElementById('corr-summary');
  var tbody = document.getElementById('corr-tbody');
  var tabsEl = document.querySelector('.corr-tf-tabs');
  var chartEl = document.getElementById('corr-chart');
  var msgEl = document.getElementById('corr-msg');

  // [label, trading days to include]
  var TIMEFRAMES = [
    ['1M', 21], ['3M', 63], ['6M', 126], ['1Y', 252], ['2Y', 504], ['5Y', 1255]
  ];

  var state = { a: null, b: null, merged: [], chartTf: '1Y' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtPct(x) {
    if (x === null || x === undefined || isNaN(x)) return '—';
    return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  }
  function fmtCorr(c) {
    if (c === null || c === undefined || isNaN(c)) return '—';
    return (c >= 0 ? '' : '−') + Math.abs(c).toFixed(2);
  }
  function corrWord(c) {
    var a = Math.abs(c);
    if (a >= 0.8) return 'very strong';
    if (a >= 0.6) return 'strong';
    if (a >= 0.4) return 'moderate';
    if (a >= 0.2) return 'weak';
    return 'very weak';
  }

  // Merge two [date, close] series on common dates
  function merge(pa, pb) {
    var mapB = {};
    pb.forEach(function (p) { mapB[p[0]] = p[1]; });
    var out = [];
    pa.forEach(function (p) {
      if (mapB[p[0]] !== undefined) out.push({ d: p[0], a: p[1], b: mapB[p[0]] });
    });
    return out; // ascending by date (Yahoo returns ascending)
  }

  // Pearson correlation of log returns over the last n merged points
  function stats(merged, n) {
    var slice = merged.slice(Math.max(0, merged.length - n));
    if (slice.length < 10) return null;
    var ra = [], rb = [];
    for (var i = 1; i < slice.length; i++) {
      ra.push(Math.log(slice[i].a / slice[i - 1].a));
      rb.push(Math.log(slice[i].b / slice[i - 1].b));
    }
    var m = ra.length;
    var ma = ra.reduce(function (s, x) { return s + x; }, 0) / m;
    var mb = rb.reduce(function (s, x) { return s + x; }, 0) / m;
    var cov = 0, va = 0, vb = 0;
    for (var j = 0; j < m; j++) {
      var da = ra[j] - ma, db = rb[j] - mb;
      cov += da * db; va += da * da; vb += db * db;
    }
    var corr = (va > 0 && vb > 0) ? cov / Math.sqrt(va * vb) : null;
    return {
      corr: corr,
      days: m,
      retA: slice[slice.length - 1].a / slice[0].a - 1,
      retB: slice[slice.length - 1].b / slice[0].b - 1,
      slice: slice
    };
  }

  function corrColor(c) {
    if (c === null || c === undefined) return 'var(--color-text-muted)';
    // Positive → accent blue/green scale; negative → red scale
    if (c >= 0) {
      var t = Math.min(1, c);
      return 'rgb(' + Math.round(46 + (1 - t) * 120) + ',' +
        Math.round(125 + (1 - t) * 40) + ',' + Math.round(50 + (1 - t) * 90) + ')';
    }
    var u = Math.min(1, -c);
    return 'rgb(' + Math.round(190 + u * 28) + ',' + Math.round(60 - u * 42) + ',' + Math.round(50 - u * 30) + ')';
  }

  function renderTable() {
    document.getElementById('corr-th-a').textContent = state.a + ' return';
    document.getElementById('corr-th-b').textContent = state.b + ' return';
    tbody.innerHTML = '';
    var rows = {};
    TIMEFRAMES.forEach(function (tf) {
      var s = stats(state.merged, tf[1]);
      var tr = document.createElement('tr');
      tr.className = 'corr-row' + (tf[0] === state.chartTf ? ' active' : '');
      tr.setAttribute('data-tf', tf[0]);
      if (!s) {
        tr.innerHTML = '<td>' + tf[0] + '</td><td colspan="4">not enough data</td>';
      } else {
        rows[tf[0]] = s;
        var barW = s.corr === null ? 0 : Math.round(Math.abs(s.corr) * 50);
        tr.innerHTML =
          '<td class="tf">' + tf[0] + '</td>' +
          '<td><span class="corr-val" style="color:' + corrColor(s.corr) + '">' + fmtCorr(s.corr) + '</span>' +
          '<span class="corr-bar"><span class="corr-bar-fill" style="width:' + barW + '%;background:' + corrColor(s.corr) + '"></span></span></td>' +
          '<td>' + fmtPct(s.retA) + '</td>' +
          '<td>' + fmtPct(s.retB) + '</td>' +
          '<td>' + s.days + '</td>';
      }
      tr.addEventListener('click', function () {
        state.chartTf = tf[0];
        renderTable();
        renderTabs();
        drawChart();
      });
      tbody.appendChild(tr);
    });
    // Summary from the 1Y row
    var y = rows['1Y'] || rows['5Y'];
    if (y && y.corr !== null) {
      var dir = y.corr >= 0 ? 'together' : 'in opposite directions';
      summaryEl.textContent = state.a + ' and ' + state.b + ' have a ' + corrWord(y.corr) +
        (y.corr >= 0 ? ' positive' : ' negative') + ' correlation over the past year (' +
        fmtCorr(y.corr) + ') — historically they have tended to move ' + dir + '.';
    } else {
      summaryEl.textContent = '';
    }
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    TIMEFRAMES.forEach(function (tf) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mv-friend corr-tab' + (tf[0] === state.chartTf ? ' active' : '');
      b.textContent = tf[0];
      b.addEventListener('click', function () {
        state.chartTf = tf[0];
        renderTable();
        renderTabs();
        drawChart();
      });
      tabsEl.appendChild(b);
    });
  }

  function drawChart() {
    var tf = TIMEFRAMES.filter(function (t) { return t[0] === state.chartTf; })[0];
    var s = stats(state.merged, tf[1]);
    var ctx = chartEl.getContext('2d');
    var W = chartEl.clientWidth || 700;
    var H = 260;
    var dpr = window.devicePixelRatio || 1;
    chartEl.width = W * dpr;
    chartEl.height = H * dpr;
    chartEl.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (!s) return;
    var slice = s.slice;
    // Normalize both to 100 at start
    var na = slice.map(function (p) { return p.a / slice[0].a * 100; });
    var nb = slice.map(function (p) { return p.b / slice[0].b * 100; });
    var min = Math.min.apply(null, na.concat(nb));
    var max = Math.max.apply(null, na.concat(nb));
    var pad = (max - min) * 0.08 || 1;
    min -= pad; max += pad;
    var padL = 8, padR = 8, padT = 14, padB = 22;
    function X(i) { return padL + (W - padL - padR) * i / (slice.length - 1); }
    function Y(v) { return padT + (H - padT - padB) * (1 - (v - min) / (max - min)); }
    var dark = document.documentElement.classList.contains('dark') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches &&
        !document.documentElement.classList.contains('light'));
    // Gridlines at 100
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, Y(100)); ctx.lineTo(W - padR, Y(100)); ctx.stroke();
    ctx.setLineDash([]);
    function line(vals, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      vals.forEach(function (v, i) {
        if (i === 0) ctx.moveTo(X(i), Y(v)); else ctx.lineTo(X(i), Y(v));
      });
      ctx.stroke();
    }
    line(nb, '#e8a33d');
    line(na, '#3b82f6');
    // Legend + endpoints
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#3b82f6';
    ctx.fillText('■ ' + state.a + '  ' + fmtPct(s.retA), padL + 2, 12);
    ctx.fillStyle = '#e8a33d';
    var labelB = '■ ' + state.b + '  ' + fmtPct(s.retB);
    ctx.fillText(labelB, padL + 130, 12);
    // Date axis: first / last
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(slice[0].d, padL, H - 6);
    var last = slice[slice.length - 1].d;
    ctx.fillText(last, W - padR - ctx.measureText(last).width, H - 6);
  }

  function calculate(a, b) {
    msgEl.textContent = 'Loading price history…';
    resultsEl.hidden = true;
    function fetchSym(sym) {
      return fetch(WORKER_URL + '/corr/prices?symbol=' + encodeURIComponent(sym))
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
    }
    Promise.all([fetchSym(a), fetchSym(b)]).then(function (res) {
      if (!res[0].ok) { msgEl.textContent = a + ': ' + ((res[0].j && res[0].j.error) || 'not found'); return; }
      if (!res[1].ok) { msgEl.textContent = b + ': ' + ((res[1].j && res[1].j.error) || 'not found'); return; }
      msgEl.textContent = '';
      state.a = a; state.b = b;
      state.merged = merge(res[0].j.points, res[1].j.points);
      if (state.merged.length < 30) {
        msgEl.textContent = 'Not enough overlapping history between ' + a + ' and ' + b + '.';
        return;
      }
      resultsEl.hidden = false;
      renderTable();
      renderTabs();
      drawChart();
    }).catch(function () {
      msgEl.textContent = 'Could not load data — check your connection.';
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var a = aEl.value.trim().toUpperCase();
    var b = bEl.value.trim().toUpperCase();
    if (!a || !b) { msgEl.textContent = 'Enter both tickers.'; return; }
    if (a === b) { msgEl.textContent = 'Pick two different tickers.'; return; }
    calculate(a, b);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.corr-preset'), function (btn) {
    btn.addEventListener('click', function () {
      aEl.value = btn.getAttribute('data-a');
      bEl.value = btn.getAttribute('data-b');
      calculate(aEl.value, bEl.value);
    });
  });
  window.addEventListener('resize', function () {
    if (!resultsEl.hidden) drawChart();
  });
})();
