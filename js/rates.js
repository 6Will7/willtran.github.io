/* U.S. Treasury yields — via the worker's /treasury route (FRED). */
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
  var rateData = null;
  var showHist = { w1: false, m1: false, y1: false };

  document.querySelectorAll('.rates-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var k = chip.getAttribute('data-hist');
      showHist[k] = !showHist[k];
      chip.classList.toggle('active', showHist[k]);
      chip.setAttribute('aria-pressed', showHist[k] ? 'true' : 'false');
      drawCurve();
    });
  });

  function accentColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
    return (v || '#FCDD09').trim();
  }

  function drawCurve() {
    if (!curveEl || !rateData || !rateData.rows.length) return;
    var rows = rateData.rows;
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

  fetch(WORKER_URL + '/treasury')
    .then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var rows = (d && d.rows) || [];
      if (!rows.length) throw new Error('empty');
      meta.innerHTML = d.live
        ? '<span class="rates-live-dot" aria-hidden="true"></span>Live · ' + esc(d.asOf || '') + ' · Source: CNBC'
        : 'Yields as of ' + fmtDate(d.asOf) + ' · Source: FRED';
      rateData = d;
      drawCurve();
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
    })
    .catch(function (e) {
      meta.textContent = 'U.S. Treasury yields';
      body.innerHTML = '<tr><td colspan="6"><div class="rates-error">' +
        'Could not load yields right now. Please try again later.</div></td></tr>';
    });
})();
