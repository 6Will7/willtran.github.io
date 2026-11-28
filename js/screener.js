/* Screener — client-side filtering over js/screener-data.js (built
   quarterly by tools/build-screener.py from Finnhub metrics + Yahoo
   prices). Row: [sym, name, sector, industry, mcapM, pe, ps, pb,
   divYield, beta, epsTTM, revGrowth, grossMargin, roe, price, dayChg,
   pos52w]. If the dataset hasn't landed yet, the page says so. */
(function () {
  'use strict';
  var msgEl = document.getElementById('scr-msg');
  var filtersEl = document.getElementById('scr-filters');
  var resultsEl = document.getElementById('scr-results');
  var tbodyEl = document.getElementById('scr-tbody');
  var countEl = document.getElementById('scr-count');
  var metaEl = document.getElementById('scr-meta');
  var moreBtn = document.getElementById('scr-more');
  var PAGE = 100, shown = PAGE;
  var sortCol = 4, sortDir = -1; // market cap desc by default

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMcap(m) {
    if (m == null || isNaN(m)) return '—';
    var usd = m * 1e6;
    if (usd >= 1e12) return '$' + (usd / 1e12).toFixed(2) + 'T';
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(1) + 'B';
    return '$' + Math.round(usd / 1e6) + 'M';
  }
  function fmt1(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(1); }
  function fmt2(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2); }
  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  function filtered() {
    var q = val('scr-q').trim().toLowerCase();
    var sector = val('scr-sector'), industry = val('scr-industry');
    var mcapMin = parseFloat(val('scr-mcap')) || 0;
    var peMax = parseFloat(val('scr-pe')) || Infinity;
    var psMax = parseFloat(val('scr-ps')) || Infinity;
    var divMin = parseFloat(val('scr-div')) || 0;
    var betaMax = parseFloat(val('scr-beta')) || Infinity;
    var pos = val('scr-pos'), chg = val('scr-chg');
    return SCR.filter(function (r) {
      if (q && r[0].toLowerCase().indexOf(q) < 0 && (r[1] || '').toLowerCase().indexOf(q) < 0) return false;
      if (sector && r[2] !== sector) return false;
      if (industry && r[3] !== industry) return false;
      if (mcapMin && (r[4] == null || r[4] < mcapMin)) return false;
      if (peMax !== Infinity && (r[5] == null || r[5] > peMax || r[5] <= 0)) return false;
      if (psMax !== Infinity && (r[6] == null || r[6] > psMax)) return false;
      if (divMin && (r[8] == null || r[8] < divMin)) return false;
      if (betaMax !== Infinity && (r[9] == null || r[9] > betaMax)) return false;
      if (pos === 'low' && (r[16] == null || r[16] >= 25)) return false;
      if (pos === 'mid' && (r[16] == null || r[16] < 25 || r[16] > 75)) return false;
      if (pos === 'high' && (r[16] == null || r[16] <= 75)) return false;
      if (chg === 'up2' && (r[15] == null || r[15] <= 2)) return false;
      if (chg === 'dn2' && (r[15] == null || r[15] >= -2)) return false;
      return true;
    });
  }

  function sorted(rows) {
    return rows.slice().sort(function (a, b) {
      var av = a[sortCol], bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return sortDir * av.localeCompare(bv);
      return sortDir * (av - bv);
    });
  }

  function render() {
    var rows = sorted(filtered());
    var total = rows.length;
    var page = rows.slice(0, shown);
    tbodyEl.innerHTML = page.map(function (r) {
      var dayCls = (r[15] == null) ? '' : (r[15] >= 0 ? 'up' : 'down');
      var posBar = (r[16] == null) ? '—' :
        '<span class="scr-pos"><span class="scr-pos-track"><i style="left:' +
        Math.max(0, Math.min(100, r[16])) + '%"></i></span>' + Math.round(r[16]) + '%</span>';
      return '<tr><td><a href="/stocks/?symbol=' + esc(r[0]) + '"><strong>' + esc(r[0]) + '</strong></a></td>' +
        '<td>' + esc(r[1] || '') + '</td>' +
        '<td class="num">' + fmtMcap(r[4]) + '</td>' +
        '<td class="num">' + fmt1(r[5]) + '</td>' +
        '<td class="num">' + fmt1(r[6]) + '</td>' +
        '<td class="num">' + fmt2(r[8]) + '</td>' +
        '<td class="num">' + fmt2(r[9]) + '</td>' +
        '<td class="num">$' + fmt2(r[14]) + '</td>' +
        '<td class="num ' + dayCls + '">' + fmtPct(r[15]) + '</td>' +
        '<td class="num">' + posBar + '</td></tr>';
    }).join('') || '<tr><td colspan="10">No stocks match these filters.</td></tr>';
    countEl.textContent = total.toLocaleString('en-US') + ' matching · showing ' +
      Math.min(shown, total).toLocaleString('en-US');
    moreBtn.hidden = total <= shown;
    document.querySelectorAll('.scr-table th[data-sort]').forEach(function (th) {
      var col = parseInt(th.getAttribute('data-sort'), 10);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') +
        (col === sortCol ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
    });
  }

  function fillSelect(id, values) {
    var el = document.getElementById(id);
    var cur = el.value;
    el.innerHTML = '<option value="">' + (id === 'scr-sector' ? 'All sectors' : 'All industries') + '</option>' +
      values.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
  }

  function init() {
    if (typeof SCR === 'undefined' || !SCR.length) {
      msgEl.textContent = 'The screener dataset is still being built (3,002 tickers, quarterly refresh) — check back shortly. The Stocks page works meanwhile.';
      return;
    }
    msgEl.textContent = '';
    filtersEl.hidden = false;
    resultsEl.hidden = false;
    if (typeof SCR_META !== 'undefined') {
      metaEl.textContent = 'Dataset built ' + (SCR_META.gen || '') + ' · ' +
        (SCR_META.count || SCR.length).toLocaleString('en-US') +
        ' tickers · fundamentals via Finnhub, prices via Yahoo Finance.';
    }
    var sectors = [], industries = [];
    SCR.forEach(function (r) {
      if (r[2] && sectors.indexOf(r[2]) < 0) sectors.push(r[2]);
      if (r[3] && industries.indexOf(r[3]) < 0) industries.push(r[3]);
    });
    sectors.sort();
    fillSelect('scr-sector', sectors);
    document.getElementById('scr-sector').addEventListener('change', function () {
      var s = this.value;
      var inds = [];
      SCR.forEach(function (r) {
        if ((!s || r[2] === s) && r[3] && inds.indexOf(r[3]) < 0) inds.push(r[3]);
      });
      inds.sort();
      fillSelect('scr-industry', inds);
      shown = PAGE;
      render();
    });
    fillSelect('scr-industry', industries.sort());
    ['scr-q', 'scr-mcap', 'scr-pe', 'scr-ps', 'scr-div', 'scr-beta', 'scr-pos', 'scr-chg']
      .forEach(function (id) {
        var el = document.getElementById(id);
        el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () {
          shown = PAGE;
          render();
        });
      });
    document.getElementById('scr-reset').addEventListener('click', function () {
      ['scr-q', 'scr-sector', 'scr-industry', 'scr-mcap', 'scr-pe', 'scr-ps',
       'scr-div', 'scr-beta', 'scr-pos', 'scr-chg'].forEach(function (id) {
        document.getElementById(id).value = '';
      });
      fillSelect('scr-industry', industries.sort());
      sortCol = 4; sortDir = -1;
      shown = PAGE;
      render();
    });
    document.querySelectorAll('.scr-table th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = parseInt(th.getAttribute('data-sort'), 10);
        if (col === sortCol) sortDir = -sortDir;
        else { sortCol = col; sortDir = (col <= 1) ? 1 : -1; }
        shown = PAGE;
        render();
      });
    });
    moreBtn.addEventListener('click', function () { shown += PAGE; render(); });
    render();
  }

  // screener-data.js loads with defer after this script tag order-wise;
  // both are deferred so they run in order — but a 404 data file means
  // SCR is undefined, handled above.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
