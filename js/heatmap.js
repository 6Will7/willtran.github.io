/* Market heat map — ETF holdings as a sector-grouped treemap.
 * Data: /nasdaq/list (QQQ, live) or /etf/holdings + /quote (other ETFs).
 * Tiles link to /stocks/?symbol= for the full quote page.
 */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';

  var mapEl = document.getElementById('hm-map');
  var metaEl = document.getElementById('hm-meta');
  var input = document.getElementById('hm-etf');
  var goBtn = document.getElementById('hm-go');
  var presets = document.querySelectorAll('.hm-preset');
  var tileBySym = {};

  function $(id) { return document.getElementById(id); }

  /* ---------- color: diverging red -> gray -> green on day % change ---------- */
  function tileColor(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '#55575f';
    var t = Math.max(-1, Math.min(1, pct / 3)); // clamp at +/-3%
    var a = 0.28 + 0.72 * Math.abs(t);
    if (t >= 0) return 'rgba(22,163,74,' + a.toFixed(2) + ')';
    return 'rgba(220,38,38,' + a.toFixed(2) + ')';
  }

  /* ---------- squarified treemap (Bruls et al.) ---------- */
  function squarify(items, x, y, w, h) {
    var out = [];
    var nodes = items.slice().sort(function (a, b) { return b.w - a.w; });
    var total = 0, i;
    for (i = 0; i < nodes.length; i++) total += nodes[i].w;
    if (total <= 0 || w <= 0 || h <= 0) return out;
    var scale = (w * h) / total;
    var row = [], rowArea = 0;
    var cx = x, cy = y, cw = w, ch = h;

    function worst(list, area, side) {
      var mx = 0, mn = Infinity, k, a;
      for (k = 0; k < list.length; k++) {
        a = list[k].w * scale;
        if (a > mx) mx = a;
        if (a < mn) mn = a;
      }
      return Math.max((side * side * mx) / (area * area),
                      (area * area) / (side * side * mn));
    }
    function flushRow() {
      var horizontal = cw >= ch, pos = 0, k, a;
      if (horizontal) {
        var rh = rowArea / cw;
        for (k = 0; k < row.length; k++) {
          a = row[k].w * scale;
          out.push({ item: row[k], x: cx + pos, y: cy, w: a / rh, h: rh });
          pos += a / rh;
        }
        cy += rh; ch -= rh;
      } else {
        var rw = rowArea / ch;
        for (k = 0; k < row.length; k++) {
          a = row[k].w * scale;
          out.push({ item: row[k], x: cx, y: cy + pos, w: rw, h: a / rw });
          pos += a / rw;
        }
        cx += rw; cw -= rw;
      }
      row = []; rowArea = 0;
    }

    for (i = 0; i < nodes.length; i++) {
      var side = Math.min(cw, ch);
      var na = nodes[i].w * scale;
      if (row.length && worst(row.concat([nodes[i]]), rowArea + na, side) > worst(row, rowArea, side)) {
        flushRow();
      }
      row.push(nodes[i]); rowArea += na;
    }
    if (row.length) flushRow();
    return out;
  }

  function sectorOf(sym) {
    var g = (typeof GICS !== 'undefined' && GICS[sym]) || null;
    return g ? g.s : 'Other';
  }

  function px(n) { return Math.max(0, n).toFixed(1) + 'px'; }

  function makeTile(h, r) {
    var a = document.createElement('a');
    a.className = 'hm-tile' + (h.pct === null || h.pct === undefined ? ' loading' : '');
    a.href = '/stocks/?symbol=' + encodeURIComponent(h.s);
    a.title = (h.name || h.s) + (h.pct !== null && h.pct !== undefined ? ' ' + fmtPct(h.pct) : '');
    a.style.left = px(r.x); a.style.top = px(r.y);
    a.style.width = px(r.w); a.style.height = px(r.h);
    a.style.background = tileColor(h.pct);
    var showT = r.w > 34 && r.h > 24;
    if (showT) {
      var fs = Math.max(8, Math.min(15, r.w / (h.s.length * 0.72), r.h / 3.2));
      var t = document.createElement('span');
      t.className = 't'; t.textContent = h.s;
      t.style.fontSize = fs.toFixed(1) + 'px';
      a.appendChild(t);
      if (r.h > 46 && h.pct !== null && h.pct !== undefined) {
        var p = document.createElement('span');
        p.className = 'p'; p.textContent = fmtPct(h.pct);
        p.style.fontSize = (fs * 0.72).toFixed(1) + 'px';
        a.appendChild(p);
      }
    }
    tileBySym[h.s] = a;
    return a;
  }

  function fmtPct(p) { return (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }

  function render(holdings) {
    mapEl.innerHTML = '';
    tileBySym = {};
    var W = mapEl.clientWidth, H = mapEl.clientHeight;
    if (!W || !H) return;
    var sectors = {};
    holdings.forEach(function (h) {
      var s = sectorOf(h.s);
      (sectors[s] = sectors[s] || []).push(h);
    });
    var sItems = Object.keys(sectors).map(function (k) {
      var ws = 0, i;
      for (i = 0; i < sectors[k].length; i++) ws += sectors[k][i].w;
      return { key: k, w: ws, children: sectors[k] };
    });
    var pad = 3;
    squarify(sItems, 0, 0, W, H).forEach(function (sr) {
      var sec = document.createElement('div');
      sec.className = 'hm-sector';
      sec.style.left = px(sr.x); sec.style.top = px(sr.y);
      sec.style.width = px(sr.w); sec.style.height = px(sr.h);
      var showLabel = sr.h > 34 && sr.w > 110;
      if (showLabel) {
        var lab = document.createElement('span');
        lab.className = 'hm-sector-label';
        lab.textContent = sr.item.key;
        sec.appendChild(lab);
      }
      var topPad = showLabel ? 18 : pad;
      squarify(sr.item.children, pad, topPad, sr.w - pad * 2, sr.h - topPad - pad)
        .forEach(function (hr) {
          sec.appendChild(makeTile(hr.item, {
            x: hr.x, y: hr.y, w: Math.max(0, hr.w - 2), h: Math.max(0, hr.h - 2)
          }));
        });
      mapEl.appendChild(sec);
    });
  }

  function updateTile(h) {
    var a = tileBySym[h.s];
    if (!a) return;
    a.classList.remove('loading');
    a.style.background = tileColor(h.pct);
    a.title = (h.name || h.s) + ' ' + fmtPct(h.pct);
    var p = a.querySelector('.p');
    var r = a.getBoundingClientRect();
    if (!p && r.height > 46) {
      p = document.createElement('span');
      p.className = 'p';
      var t = a.querySelector('.t');
      p.style.fontSize = (parseFloat(t.style.fontSize) * 0.72).toFixed(1) + 'px';
      a.appendChild(p);
    }
    if (p) p.textContent = fmtPct(h.pct);
  }

  function setActive(etf) {
    for (var i = 0; i < presets.length; i++) {
      presets[i].classList.toggle('active', presets[i].getAttribute('data-etf') === etf);
    }
  }

  function err(msg) {
    mapEl.innerHTML = '';
    metaEl.textContent = '';
    var d = document.createElement('p');
    d.className = 'hm-error';
    d.textContent = msg;
    mapEl.appendChild(d);
  }

  async function quoteFor(h) {
    try {
      var r = await fetch(WORKER_URL + '/quote?symbol=' + encodeURIComponent(h.s));
      var j = await r.json();
      if (r.ok && typeof j.dp === 'number') { h.pct = j.dp; updateTile(h); }
    } catch (e) { /* tile stays gray */ }
  }

  // limited-concurrency pool so we stay well under the Finnhub rate limit
  async function pool(items, n, fn) {
    var i = 0;
    var workers = [];
    for (var k = 0; k < n; k++) {
      workers.push((async function () {
        while (i < items.length) { var it = items[i++]; await fn(it); }
      })());
    }
    await Promise.all(workers);
  }

  async function load(etf) {
    setActive(etf);
    metaEl.textContent = 'Loading ' + etf + '…';
    mapEl.innerHTML = '';
    try {
      var holdings, meta;
      if (etf === 'QQQ') {
        var r = await fetch(WORKER_URL + '/nasdaq/list?list=nasdaq100');
        var j = await r.json();
        if (!r.ok || !j.holdings || !j.holdings.length) throw new Error('holdings unavailable');
        var total = 0, i;
        for (i = 0; i < j.holdings.length; i++) total += j.holdings[i].mcap;
        holdings = j.holdings.map(function (h) {
          return { s: h.s, name: h.name, w: (h.mcap / total) * 100, pct: h.pct };
        });
        meta = 'Nasdaq 100 · ' + j.holdings.length + ' holdings · sized by market cap' +
               (j.asOf ? ' · ' + j.asOf : '');
        render(holdings);
      } else {
        var r2 = await fetch(WORKER_URL + '/etf/holdings?symbol=' + encodeURIComponent(etf));
        var j2 = await r2.json();
        if (!r2.ok || !j2.holdings || !j2.holdings.length) {
          throw new Error(j2.error || ('no holdings found for ' + etf));
        }
        holdings = j2.holdings.map(function (h) {
          return { s: h.s, name: h.name, w: h.w, pct: null };
        });
        meta = etf + ' · top ' + holdings.length + ' holdings by index weight · fetching live prices…';
        metaEl.textContent = meta;
        render(holdings);
        await pool(holdings, 6, quoteFor);
        meta = etf + ' · top ' + holdings.length + ' holdings by index weight';
      }
      metaEl.textContent = meta;
    } catch (e) {
      err(e.message || 'Could not load holdings.');
    }
  }

  for (var i = 0; i < presets.length; i++) {
    presets[i].addEventListener('click', function () {
      load(this.getAttribute('data-etf'));
    });
  }
  function goCustom() {
    var v = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (!v) return;
    input.value = v;
    load(v);
  }
  goBtn.addEventListener('click', goCustom);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') goCustom(); });

  var rAF = window.requestAnimationFrame || function (f) { f(); };
  rAF(function () { load('SPY'); });
})();
