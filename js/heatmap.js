/* Market heat map — ETF holdings as a sector-grouped treemap.
 * Data: /nasdaq/list (QQQ, live) or /etf/holdings + /quote (other ETFs).
 * Tiles link to /stocks/?symbol= for the full quote page.
 */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';

  var mapEl = document.getElementById('hm-map');
  var metaEl = document.getElementById('hm-meta');
  var freshEl = document.getElementById('hm-fresh');
  var input = document.getElementById('hm-etf');
  var goBtn = document.getElementById('hm-go');
  var presets = document.querySelectorAll('.hm-preset');
  var tileBySym = {};

  function $(id) { return document.getElementById(id); }

  /* ---------- colors: vivid Finviz-style diverging scale ---------- */
  function tileColor(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '#3a3b40';
    var t = Math.max(-1, Math.min(1, pct / 3)); // clamp at +/-3%
    var a = (0.35 + 0.65 * Math.abs(t)).toFixed(2);
    if (t >= 0) return 'rgba(56,142,60,' + a + ')';
    return 'rgba(211,47,47,' + a + ')';
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
      // The strip is always laid across the LONGEST side of the remaining
      // rect (see flushRow) — worst() must evaluate that same geometry,
      // otherwise single items flush alone and the map degenerates into bands.
      var L = Math.max(cw, ch);
      var na = nodes[i].w * scale;
      if (row.length && worst(row.concat([nodes[i]]), rowArea + na, L) > worst(row, rowArea, L)) {
        flushRow();
      }
      row.push(nodes[i]); rowArea += na;
    }
    if (row.length) flushRow();
    return out;
  }

  function sectorIndOf(sym) {
    var g = (typeof GICS !== 'undefined' && GICS[sym]) || null;
    return { s: g ? g.s : 'Other', i: (g && g.i) ? g.i : 'Other' };
  }

  function px(n) { return Math.max(0, n).toFixed(1) + 'px'; }

  function groupLabel(parent, text, cls, minW, minH) {
    var r = parent.getBoundingClientRect();
    if (r.height < minH || r.width < minW) return;
    var lab = document.createElement('span');
    lab.className = cls;
    lab.textContent = text;
    parent.appendChild(lab);
  }

  function makeTile(h, r) {
    var a = document.createElement('a');
    a.className = 'hm-tile' + (h.pct === null || h.pct === undefined ? ' loading' : '');
    a.href = '/stocks/?symbol=' + encodeURIComponent(h.s);
    a.title = (h.name || h.s) + (h.pct !== null && h.pct !== undefined ? ' ' + fmtPct(h.pct) : '');
    a.style.left = px(r.x); a.style.top = px(r.y);
    a.style.width = px(r.w); a.style.height = px(r.h);
    a.style.background = tileColor(h.pct);
    var showT = r.w > 26 && r.h > 18;
    if (showT) {
      var fs = Math.max(7.5, Math.min(22, r.w / (h.s.length * 0.62), r.h / 2.6));
      var t = document.createElement('span');
      t.className = 't'; t.textContent = h.s;
      t.style.fontSize = fs.toFixed(1) + 'px';
      a.appendChild(t);
      if (r.h > fs * 2.5 && h.pct !== null && h.pct !== undefined) {
        var p = document.createElement('span');
        p.className = 'p'; p.textContent = fmtPct(h.pct);
        p.style.fontSize = (fs * 0.78).toFixed(1) + 'px';
        a.appendChild(p);
      }
    }
    tileBySym[h.s] = a;
    return a;
  }

  function fmtPct(p) { return (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }

  // Three-level treemap: sector -> industry -> ticker, Finviz-style.
  // Tighter packing and bigger type than the old two-level version.
  function render(holdings) {
    mapEl.innerHTML = '';
    tileBySym = {};
    var W = mapEl.clientWidth, H = mapEl.clientHeight;
    if (!W || !H) return;

    var tree = {};
    holdings.forEach(function (h) {
      var gi = sectorIndOf(h.s);
      tree[gi.s] = tree[gi.s] || {};
      (tree[gi.s][gi.i] = tree[gi.s][gi.i] || []).push(h);
    });
    function sumW(items) {
      var s = 0, i;
      for (i = 0; i < items.length; i++) s += items[i].w;
      return s;
    }
    var sItems = Object.keys(tree).map(function (sk) {
      var inds = Object.keys(tree[sk]).map(function (ik) {
        return { key: ik, w: sumW(tree[sk][ik]), children: tree[sk][ik] };
      });
      return { key: sk, w: sumW(inds), children: inds };
    });
    // Merge dust sectors (<1.2% of displayed weight) into "Other" — otherwise
    // the long tail collapses into illegible hairline strips along one edge.
    var totalW = sumW(sItems), kept = [], otherW = 0, otherKids = [];
    sItems.forEach(function (s) {
      if (s.key !== 'Other' && s.w / totalW < 0.012) {
        otherW += s.w;
        otherKids = otherKids.concat(s.children);
      } else kept.push(s);
    });
    if (otherW > 0) {
      var ex = null, k;
      for (k = 0; k < kept.length; k++) if (kept[k].key === 'Other') ex = kept[k];
      if (ex) { ex.w += otherW; ex.children = ex.children.concat(otherKids); }
      else kept.push({ key: 'Other', w: otherW, children: otherKids });
    }
    sItems = kept;

    squarify(sItems, 0, 0, W, H).forEach(function (sr) {
      var sec = document.createElement('div');
      sec.className = 'hm-sector';
      sec.style.left = px(sr.x); sec.style.top = px(sr.y);
      sec.style.width = px(sr.w); sec.style.height = px(sr.h);
      mapEl.appendChild(sec);
      groupLabel(sec, sr.item.key, 'hm-sector-label', 90, 30);

      var sp = 2, stop = sec.querySelector('.hm-sector-label') ? 17 : sp;
      squarify(sr.item.children, sp, stop, sr.w - sp * 2, sr.h - stop - sp)
        .forEach(function (ir) {
          var ind = document.createElement('div');
          ind.className = 'hm-industry';
          ind.style.left = px(ir.x); ind.style.top = px(ir.y);
          ind.style.width = px(ir.w); ind.style.height = px(ir.h);
          sec.appendChild(ind);
          groupLabel(ind, ir.item.key, 'hm-industry-label', 60, 24);

          var ip = 1, itop = ind.querySelector('.hm-industry-label') ? 13 : ip;
          squarify(ir.item.children, ip, itop, ir.w - ip * 2, ir.h - itop - ip)
            .forEach(function (hr) {
              ind.appendChild(makeTile(hr.item, {
                x: hr.x, y: hr.y,
                w: Math.max(0, hr.w - 1), h: Math.max(0, hr.h - 1)
              }));
            });
        });
    });
  }

  function updateTile(h) {
    var a = tileBySym[h.s];
    if (!a) return;
    a.classList.remove('loading');
    a.style.background = tileColor(h.pct);
    a.title = (h.name || h.s) + ' ' + fmtPct(h.pct);
    var p = a.querySelector('.p');
    var t = a.querySelector('.t');
    var r = a.getBoundingClientRect();
    var fs0 = t ? parseFloat(t.style.fontSize) : 10;
    if (!p && t && r.height > fs0 * 2.5) {
      p = document.createElement('span');
      p.className = 'p';
      p.style.fontSize = (fs0 * 0.78).toFixed(1) + 'px';
      a.appendChild(p);
    }
    if (p) p.textContent = fmtPct(h.pct);
  }

  /* ---------- freshness: when are these prices actually from? ---------- */
  // ET wall-clock helpers (the toLocaleString round-trip is the standard trick;
  // we only read wall-clock fields, never absolute time)
  function etParts(d) {
    var s = d.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(s);
  }
  function marketOpenNow() {
    var e = etParts(new Date());
    var day = e.getDay();
    if (day === 0 || day === 6) return false;
    var mins = e.getHours() * 60 + e.getMinutes();
    return mins >= 570 && mins < 960; // 9:30am–4:00pm ET
  }
  var fmtET = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  // Status line: "Prices as of Oct 1, 4:32 PM ET · Market open — live"
  // or "· Market closed", which makes weekend/stale views obvious.
  function freshnessLine(maxT, loaded, total) {
    var bits = [];
    if (maxT) bits.push('Prices as of ' + fmtET.format(new Date(maxT * 1000)) + ' ET');
    bits.push(marketOpenNow() ? 'Market open — live' : 'Market closed');
    if (total) bits.push(loaded + '/' + total + ' prices loaded');
    return bits.join(' · ');
  }
  function markMissing(holdings) {
    holdings.forEach(function (h) {
      if (h.pct === null || h.pct === undefined) {
        var a = tileBySym[h.s];
        if (a) {
          a.classList.remove('loading');
          var t2 = a.querySelector('.t');
          var r2 = a.getBoundingClientRect();
          var fs2 = t2 ? parseFloat(t2.style.fontSize) : 10;
          if (t2 && r2.height > fs2 * 2.5 && !a.querySelector('.p')) {
            var p = document.createElement('span');
            p.className = 'p';
            p.style.fontSize = (fs2 * 0.78).toFixed(1) + 'px';
            p.textContent = 'n/a';
            a.appendChild(p);
            a.title = (h.name || h.s) + ' — no price data';
          }
        }
      }
    });
  }

  function setActive(etf) {
    for (var i = 0; i < presets.length; i++) {
      presets[i].classList.toggle('active', presets[i].getAttribute('data-etf') === etf);
    }
  }

  function err(msg) {
    mapEl.innerHTML = '';
    metaEl.textContent = '';
    freshEl.textContent = '';
    var d = document.createElement('p');
    d.className = 'hm-error';
    d.textContent = msg;
    mapEl.appendChild(d);
  }

  async function quoteFor(h) {
    try {
      var r = await fetch(WORKER_URL + '/quote?symbol=' + encodeURIComponent(h.s));
      var j = await r.json();
      if (r.ok && typeof j.dp === 'number') {
        h.pct = j.dp;
        if (typeof j.t === 'number') h.t = j.t;
        updateTile(h);
      }
    } catch (e) { /* tile stays gray, marked n/a at the end */ }
  }

  // Sequential, throttled quotes: Finnhub free allows 60/min, so one
  // request per ~1.1s keeps us safely under. Tiles fill in progressively,
  // biggest holdings first (list is weight-sorted).
  async function quoteLoop(items) {
    for (var i = 0; i < items.length; i++) {
      var t0 = Date.now();
      await quoteFor(items[i]);
      var wait = 1100 - (Date.now() - t0);
      if (wait > 0 && i < items.length - 1) {
        await new Promise(function (r) { setTimeout(r, wait); });
      }
    }
  }

  var MAX_TILES = 150; // SPY has 500+ holdings; show the top 150 by weight

  async function load(etf) {
    setActive(etf);
    metaEl.textContent = 'Loading ' + etf + '…';
    freshEl.textContent = '';
    mapEl.innerHTML = '<div class="loader-center"><div class="spinner" role="status" aria-label="Loading heat map"></div></div>';
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
        metaEl.textContent = meta;
        render(holdings);
        var qmiss = holdings.filter(function (h) { return h.pct === null || h.pct === undefined; }).length;
        markMissing(holdings);
        // Nasdaq gives a date but no intraday timestamp; show it as the price date
        freshEl.textContent = 'Prices as of ' + (j.asOf || 'today') + ' (Nasdaq) · ' +
          (marketOpenNow() ? 'Market open — live' : 'Market closed') +
          ' · ' + (holdings.length - qmiss) + '/' + holdings.length + ' prices loaded';
      } else if (typeof ETF_HOLDINGS !== 'undefined' && ETF_HOLDINGS[etf]) {
        var full = ETF_HOLDINGS[etf];
        var list = full.holdings.slice(0, MAX_TILES);
        holdings = list.map(function (h) {
          return { s: h.s, name: null, w: h.w, pct: null };
        });
        meta = etf + ' · ' + list.length + ' of ' + full.count + ' holdings' +
               ' · index weights as of ' + full.asOf + ' · loading live prices…';
        metaEl.textContent = meta;
        render(holdings);
        await quoteLoop(holdings);
        var maxT = 0, loaded = 0;
        holdings.forEach(function (h) {
          if (h.pct !== null && h.pct !== undefined) {
            loaded++;
            if (h.t && h.t > maxT) maxT = h.t;
          }
        });
        markMissing(holdings);
        freshEl.textContent = freshnessLine(maxT, loaded, holdings.length);
        meta = etf + ' · ' + list.length + ' of ' + full.count + ' holdings' +
               ' · index weights as of ' + full.asOf;
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
        await quoteLoop(holdings);
        var maxT2 = 0, loaded2 = 0;
        holdings.forEach(function (h) {
          if (h.pct !== null && h.pct !== undefined) {
            loaded2++;
            if (h.t && h.t > maxT2) maxT2 = h.t;
          }
        });
        markMissing(holdings);
        freshEl.textContent = freshnessLine(maxT2, loaded2, holdings.length);
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
