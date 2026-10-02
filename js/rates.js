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

  fetch(WORKER_URL + '/treasury')
    .then(function (r) {
      if (r.status === 501) throw new Error('setup');
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var rows = (d && d.rows) || [];
      if (!rows.length) throw new Error('empty');
      meta.textContent = 'Yields as of ' + fmtDate(d.asOf) + ' · Source: FRED';
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
        (e && e.message === 'setup'
          ? 'Yields are not configured yet — the worker needs its FRED API key.'
          : 'Could not load yields right now. Please try again later.') +
        '</div></td></tr>';
    });
})();
