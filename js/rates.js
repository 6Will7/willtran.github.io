/* U.S. Treasury yields — via the worker's /treasury (live) and /treasury/history (FRED) routes. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev'; // no trailing slash

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(v) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(3);
  }

  function chgCell(chg) {
    if (chg == null || isNaN(chg)) return '<span class="rates-chg-flat">—</span>';
    var c = Number(chg);
    if (Math.abs(c) < 0.0005) return '<span class="rates-chg-flat">0.000</span>';
    var cls = c > 0 ? 'rates-chg-up' : 'rates-chg-dn';
    var arrow = c > 0 ? ' ▲' : ' ▼';
    return '<span class="' + cls + '">' + (c > 0 ? '+' : '') + c.toFixed(3) + arrow + '</span>';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0];
  }

  var meta = document.getElementById('rates-meta');
  var body = document.getElementById('rates-body');
  var curveEl = document.getElementById('rates-curve');
  var legendEl = document.getElementById('rates-legend');
  var asofWrap = document.getElementById('rates-asof');
  var dateInput = document.getElementById('rates-date');
  var latestBtn = document.getElementById('rates-latest');

  var rateData = null;   // /treasury response (live quotes + w1/m1/y1)
  var histData = null;   // /treasury/history response (full daily FRED series)
  var asOf = null;       // selected YYYY-MM-DD, or null for live/latest mode
  var showHist = { w1: false, m1: false, y1: false };

  document.querySelectorAll('.rates-chip[data-hist]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var k = chip.getAttribute('data-hist');
      showHist[k] = !showHist[k];
      chip.classList.toggle('active', showHist[k]);
      chip.setAttribute('aria-pressed', showHist[k] ? 'true' : 'false');
      renderAll();
    });
  });

  function accentColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
    return (v || '#FCDD09').trim();
  }

  /* ----- history helpers (pairs are [[date, value], ...] ascending) ----- */
  function obsIdx(pairs, dateStr) {
    var lo = 0, hi = pairs.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (pairs[mid][0] <= dateStr) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function agoVal(pairs, idx, days) {
    if (idx < 0) return null;
    var t = Date.parse(pairs[idx][0] + 'T12:00:00Z') - days * 86400000;
    for (var i = idx; i >= 0; i--) {
      if (Date.parse(pairs[i][0] + 'T12:00:00Z') <= t) return pairs[i][1];
    }
    return null;
  }

  // Canonical as-of date: the 10-YR's latest observation on/before the selection
  // (weekends/holidays snap back to the previous business day).
  function effectiveDate() {
    if (!asOf || !histData) return null;
    var pairs = histData.series['US 10-YR'] || histData.series[Object.keys(histData.series)[0]];
    if (!pairs) return null;
    var i = obsIdx(pairs, asOf);
    return i >= 0 ? pairs[i][0] : null;
  }

  function currentRows() {
    if (!rateData) return [];
    if (!asOf || !histData) return rateData.rows;
    return rateData.rows.map(function (r) {
      var pairs = histData.series[r.label];
      if (!pairs) return { label: r.label, today: null, chg: null, w1: null, m1: null, y1: null };
      var i = obsIdx(pairs, asOf);
      var v = i >= 0 ? pairs[i][1] : null;
      var prev = i > 0 ? pairs[i - 1][1] : null;
      return {
        label: r.label,
        today: v,
        chg: (v != null && prev != null) ? +((v - prev).toFixed(3)) : null,
        w1: agoVal(pairs, i, 7),
        m1: agoVal(pairs, i, 30),
        y1: agoVal(pairs, i, 365)
      };
    });
  }

  function renderTable(rows) {
    body.innerHTML = rows.map(function (t) {
      return '<tr>' +
        '<td class="sym">' + esc(t.label) + '</td>' +
        '<td class="num yld">' + fmt(t.today) + '</td>' +
        '<td class="num">' + fmt(t.w1) + '</td>' +
        '<td class="num">' + fmt(t.m1) + '</td>' +
        '<td class="num">' + fmt(t.y1) + '</td>' +
        '<td class="num">' + chgCell(t.chg) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderMeta() {
    if (asOf && histData) {
      var eff = effectiveDate();
      var snapNote = (eff && eff < asOf)
        ? ' <span class="rates-snap">(no data for ' + fmtDate(asOf) + '; showing latest)</span>' : '';
      meta.innerHTML = 'Yields as of ' + fmtDate(eff || asOf) + snapNote + ' · Source: FRED';
    } else if (rateData) {
      meta.innerHTML = rateData.live
        ? '<span class="rates-live-dot" aria-hidden="true"></span>Live · ' + esc(rateData.asOf || '') + ' · Source: CNBC'
        : 'Yields as of ' + fmtDate(rateData.asOf) + ' · Source: FRED';
    }
  }

  function renderLegend() {
    if (!legendEl) return;
    var mainLabel = (asOf && histData) ? fmtDate(effectiveDate() || asOf) : 'Today';
    var items = [{ color: accentColor(), dash: false, label: mainLabel }];
    if (showHist.w1) items.push({ color: '#9aa0a6', dash: true, label: asOf ? '1W before' : '1W ago' });
    if (showHist.m1) items.push({ color: '#7c8db0', dash: true, label: asOf ? '1M before' : '1M ago' });
    if (showHist.y1) items.push({ color: '#b08968', dash: true, label: asOf ? '1Y before' : '1Y ago' });
    legendEl.innerHTML = items.map(function (it) {
      return '<span class="rates-legend-item"><span class="lg-line" style="border-top:3px ' +
        (it.dash ? 'dashed' : 'solid') + ' ' + it.color + '"></span>' + esc(it.label) + '</span>';
    }).join('');
  }

  function drawCurve(rows) {
    if (!curveEl || !rows.length) return;
    var W = 720, H = 300, padL = 46, padR = 14, padT = 14, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var series = [{ key: 'today', color: accentColor(), width: 2.6, dash: '', dots: true }];
    if (showHist.w1) series.push({ key: 'w1', color: '#9aa0a6', width: 1.5, dash: '6,4', dots: false });
    if (showHist.m1) series.push({ key: 'm1', color: '#7c8db0', width: 1.5, dash: '6,4', dots: false });
    if (showHist.y1) series.push({ key: 'y1', color: '#b08968', width: 1.5, dash: '6,4', dots: false });
    // y domain across visible series
    var mn = Infinity, mx = -Infinity;
    series.forEach(function (s) {
      rows.forEach(function (r) {
        var v = r[s.key];
        if (v != null && !isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
      });
    });
    if (!isFinite(mn)) return;
    var pad = Math.max(0.05, (mx - mn) * 0.15);
    mn -= pad; mx += pad;
    function X(i) { return padL + (rows.length < 2 ? iw / 2 : i / (rows.length - 1) * iw); }
    function Y(v) { return padT + (1 - (v - mn) / (mx - mn)) * ih; }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="curve-svg" aria-hidden="true">';
    // gridlines + y labels
    var ticks = 5;
    for (var t = 0; t < ticks; t++) {
      var tv = mn + (mx - mn) * t / (ticks - 1);
      var ty = Y(tv).toFixed(1);
      svg += '<line x1="' + padL + '" y1="' + ty + '" x2="' + (W - padR) + '" y2="' + ty + '" class="curve-grid"/>' +
        '<text x="' + (padL - 8) + '" y="' + (+ty + 4).toFixed(1) + '" class="curve-tick" text-anchor="end">' + tv.toFixed(1) + '%</text>';
    }
    // x labels
    rows.forEach(function (r, i) {
      var short = r.label.replace('US ', '').replace('-MO', 'M').replace('-YR', 'Y');
      svg += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" class="curve-tick" text-anchor="middle">' + esc(short) + '</text>';
    });
    // series lines (break at nulls)
    series.forEach(function (s) {
      var seg = [];
      rows.forEach(function (r, i) {
        var v = r[s.key];
        if (v == null || isNaN(v)) {
          if (seg.length > 1) svg += curvePath(seg, s);
          seg = [];
        } else seg.push([X(i), Y(v), v]);
      });
      if (seg.length > 1) svg += curvePath(seg, s);
      if (s.dots) {
        seg.forEach(function (p) {
          svg += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" class="curve-dot" style="fill:' + s.color + '"/>';
        });
      }
    });
    function curvePath(seg, s) {
      var d = seg.map(function (p, j) { return (j ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var dash = s.dash ? ' stroke-dasharray="' + s.dash + '"' : '';
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + s.width + '"' + dash + ' stroke-linecap="round"/>';
    }
    svg += '</svg>';
    curveEl.innerHTML = svg;
  }

  function renderAll() {
    if (!rateData) return;
    var rows = currentRows();
    renderTable(rows);
    drawCurve(rows);
    renderMeta();
    renderLegend();
    if (latestBtn) latestBtn.hidden = !asOf;
  }

  /* ----- date picker ----- */
  if (dateInput) {
    dateInput.addEventListener('change', function () {
      var v = dateInput.value;
      if (v && histData && v >= histData.start && v <= histData.end) {
        asOf = v;
      } else {
        asOf = null;
        dateInput.value = '';
      }
      renderAll();
    });
  }
  if (latestBtn) {
    latestBtn.addEventListener('click', function () {
      asOf = null;
      if (dateInput) dateInput.value = '';
      renderAll();
    });
  }

  /* ----- data ----- */
  fetch(WORKER_URL + '/treasury')
    .then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var rows = (d && d.rows) || [];
      if (!rows.length) throw new Error('empty');
      rateData = d;
      renderAll();
    })
    .catch(function (e) {
      meta.textContent = 'U.S. Treasury yields';
      body.innerHTML = '<tr><td colspan="6"><div class="rates-error">' +
        'Could not load yields right now. Please try again later.</div></td></tr>';
    });

  // Full history enables the "as of" date picker; hidden until it loads.
  fetch(WORKER_URL + '/treasury/history')
    .then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then(function (d) {
      if (!d || !d.series || !d.start || !d.end) throw new Error('empty');
      histData = d;
      if (asofWrap) asofWrap.hidden = false;
      if (dateInput) { dateInput.min = d.start; dateInput.max = d.end; }
      renderAll();
    })
    .catch(function () { /* picker stays hidden; live mode unaffected */ });
})();
