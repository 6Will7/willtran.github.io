/* Market heat map — ETF holdings as a sector-grouped treemap.
 * Data: /nasdaq/list (QQQ, live) or State Street official holdings (js/etf-holdings.js).
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
    if (!W || !H) return {};

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

    // Sector key -> member holdings (for mobile tap-to-zoom); tile elements
    // also carry data-sector so a tap can find its sector.
    var sectorMap = {};
    squarify(sItems, 0, 0, W, H).forEach(function (sr) {
      var members = [];
      sr.item.children.forEach(function (ind) {
        ind.children.forEach(function (h) { members.push(h); });
      });
      sectorMap[sr.item.key] = members;
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
              var tile = makeTile(hr.item, {
                x: hr.x, y: hr.y,
                w: Math.max(0, hr.w - 1), h: Math.max(0, hr.h - 1)
              });
              tile.setAttribute('data-sector', sr.item.key);
              ind.appendChild(tile);
            });
        });
    });
    return sectorMap;
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
    zoomSector = null;
    overviewHoldings = null;
    displayedHoldings = null;
    overviewSectorMap = null;
    if (backBtn) backBtn.hidden = true;
    if (hintEl) hintEl.hidden = true;
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

  // Mobile summary + tap-to-zoom: phones see ALL tiles as a weight-sized
  // overview (quotes for the top 25 only), and tapping a tile zooms into
  // its sector with full live data. Desktop keeps the full quote loop.
  function isMobile() { return window.innerWidth < 640; }
  var overviewHoldings = null, displayedHoldings = null, zoomSector = null;
  var overviewSectorMap = null, overviewMeta = '', overviewFresh = '';
  var currentEtf = 'SPY', lastW = 0, lastH = 0;
  var backBtn = document.getElementById('hm-back');
  var hintEl = document.getElementById('hm-zoom-hint');

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
        currentEtf = etf;
        zoomSector = null;
        overviewHoldings = holdings;
        displayedHoldings = holdings;
        overviewSectorMap = render(holdings);
        lastW = mapEl.clientWidth; lastH = mapEl.clientHeight;
        if (backBtn) backBtn.hidden = true;
        var qmiss = holdings.filter(function (h) { return h.pct === null || h.pct === undefined; }).length;
        markMissing(holdings);
        // Nasdaq gives a date but no intraday timestamp; show it as the price date
        freshEl.textContent = 'Prices as of ' + (j.asOf || 'today') + ' (Nasdaq) · ' +
          (marketOpenNow() ? 'Market open — live' : 'Market closed') +
          ' · ' + (holdings.length - qmiss) + '/' + holdings.length + ' prices loaded';
        overviewMeta = meta;
        overviewFresh = freshEl.textContent;
        if (hintEl) {
          if (isMobile()) {
            hintEl.hidden = false;
            hintEl.textContent = 'Tap any tile to zoom into its sector.';
          } else {
            hintEl.hidden = true;
          }
        }
      } else if (typeof ETF_HOLDINGS !== 'undefined' && ETF_HOLDINGS[etf]) {
        var full = ETF_HOLDINGS[etf];
        holdings = full.holdings.map(function (h) {
          return { s: h.s, name: null, w: h.w, pct: null };
        });
        currentEtf = etf;
        zoomSector = null;
        overviewHoldings = holdings;
        displayedHoldings = holdings;
        if (backBtn) backBtn.hidden = true;
        meta = etf + ' · ' + holdings.length + ' of ' + full.count + ' holdings' +
               ' · index weights as of ' + full.asOf;
        if (isMobile()) {
          // Summary view: all tiles by weight, live prices for the top 25 only.
          // Tapping a tile zooms into its sector and loads the rest.
          overviewSectorMap = render(holdings);
          lastW = mapEl.clientWidth; lastH = mapEl.clientHeight;
          metaEl.textContent = meta;
          overviewMeta = meta;
          if (hintEl) {
            hintEl.hidden = false;
            hintEl.textContent = 'Summary view — tap any tile to zoom in and load live prices.';
          }
          freshEl.textContent = 'Loading live prices for the top 25…';
          var top25 = holdings.slice(0, 25);
          quoteLoop(top25).then(function () {
            if (zoomSector || currentEtf !== etf) return;
            var maxT = 0, loaded = 0;
            holdings.forEach(function (h) {
              if (h.pct !== null && h.pct !== undefined) {
                loaded++;
                if (h.t && h.t > maxT) maxT = h.t;
              }
            });
            markMissing(holdings);
            overviewFresh = loaded + ' of ' + holdings.length + ' priced (top 25) · ' +
              (marketOpenNow() ? 'Market open — live' : 'Market closed') +
              (maxT ? ' · as of ' + fmtET.format(new Date(maxT * 1000)) + ' ET' : '');
            freshEl.textContent = overviewFresh;
          });
        } else {
          if (hintEl) hintEl.hidden = true;
          metaEl.textContent = meta + ' · loading live prices…';
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
          overviewFresh = freshEl.textContent;
          overviewMeta = meta;
          metaEl.textContent = meta;
          lastW = mapEl.clientWidth; lastH = mapEl.clientHeight;
        }
      } else {
        // Official holdings only (State Street SPDRs + Nasdaq 100) —
        // no third-party scrape fallback. Anything else gets a clean note.
        throw new Error('No official holdings data for ' + etf +
          ' — try SPY, DIA, QQQ, XLF, XBI, or a sector ETF.');
      }
    } catch (e) {
      err(e.message || 'Could not load holdings.');
    }
  }

  // Mobile tap-to-zoom: drill into a sector, load its live data, back out.
  function zoomToSector(key) {
    if (!overviewSectorMap) return;
    var sub = overviewSectorMap[key];
    if (!sub || !sub.length) return;
    zoomSector = key;
    displayedHoldings = sub;
    render(sub);
    lastW = mapEl.clientWidth; lastH = mapEl.clientHeight;
    if (backBtn) backBtn.hidden = false;
    if (hintEl) hintEl.hidden = true;
    metaEl.textContent = currentEtf + ' · ' + key + ' · ' + sub.length +
      ' holdings · loading live prices…';
    freshEl.textContent = '';
    mapEl.scrollIntoView({ block: 'nearest' });
    var need = sub.filter(function (h) { return h.pct === null || h.pct === undefined; });
    quoteLoop(need).then(function () {
      if (zoomSector !== key) return; // user went back mid-load
      var maxT = 0, loaded = 0;
      sub.forEach(function (h) {
        if (h.pct !== null && h.pct !== undefined) {
          loaded++;
          if (h.t && h.t > maxT) maxT = h.t;
        }
      });
      markMissing(sub);
      freshEl.textContent = freshnessLine(maxT, loaded, sub.length);
      metaEl.textContent = currentEtf + ' · ' + key + ' · ' + sub.length + ' holdings';
    });
  }

  function backToOverview() {
    zoomSector = null;
    displayedHoldings = overviewHoldings;
    if (overviewHoldings) overviewSectorMap = render(overviewHoldings);
    lastW = mapEl.clientWidth; lastH = mapEl.clientHeight;
    if (backBtn) backBtn.hidden = true;
    if (hintEl && isMobile() && overviewHoldings) {
      hintEl.hidden = false;
      hintEl.textContent = 'Summary view — tap any tile to zoom in and load live prices.';
    }
    if (overviewMeta) metaEl.textContent = overviewMeta;
    if (overviewFresh) freshEl.textContent = overviewFresh;
  }

  if (backBtn) backBtn.addEventListener('click', backToOverview);

  // On mobile overview, tapping a tile zooms into its sector instead of
  // navigating away; once zoomed, tiles link to /stocks/ as usual.
  mapEl.addEventListener('click', function (e) {
    if (!isMobile() || zoomSector || !overviewSectorMap) return;
    var t = e.target && e.target.closest ? e.target.closest('.hm-tile') : null;
    if (!t) return;
    var key = t.getAttribute('data-sector');
    if (!key) return;
    e.preventDefault();
    zoomToSector(key);
  });

  // Re-lay out (no refetch) on resize/rotation — debounced, and skipped for
  // tiny iOS scroll-driven size jitters.
  var resizeT = null;
  window.addEventListener('resize', function () {
    if (!displayedHoldings) return;
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      var W = mapEl.clientWidth, H = mapEl.clientHeight;
      if (Math.abs(W - lastW) < 4 && Math.abs(H - lastH) < 4) return;
      if (zoomSector) {
        render(displayedHoldings);
      } else if (overviewHoldings) {
        overviewSectorMap = render(overviewHoldings);
        displayedHoldings = overviewHoldings;
      }
      lastW = W; lastH = H;
    }, 250);
  });

  for (var i = 0; i < presets.length; i++) {
    presets[i].addEventListener('click', function () {
      load(this.getAttribute('data-etf'));
    });
  }

  /* ----- Sector ETF picker ("Click here for Sector ETFs") ----- */
  var SECTORS = [
    { t: 'XLK', label: 'Information Technology' },
    { t: 'XLV', label: 'Health Care' },
    { t: 'XLF', label: 'Financials' },
    { t: 'XLY', label: 'Consumer Discretionary' },
    { t: 'XLI', label: 'Industrials' },
    { t: 'XLC', label: 'Communication Services' },
    { t: 'XLP', label: 'Consumer Staples' },
    { t: 'XLE', label: 'Energy' },
    { t: 'XLU', label: 'Utilities' },
    { t: 'XLRE', label: 'Real Estate' },
    { t: 'XLB', label: 'Materials' }
  ];
  var sectorBtn = document.getElementById('hm-sector-btn');
  var sectorMenu = document.getElementById('hm-sector-menu');

  function closeSectors() {
    sectorMenu.hidden = true;
    sectorBtn.setAttribute('aria-expanded', 'false');
  }

  if (sectorBtn && sectorMenu) {
    sectorMenu.innerHTML = SECTORS.map(function (s) {
      return '<button type="button" class="hm-sector-item" data-ticker="' + s.t + '">' +
        '<strong>' + escH(s.t) + '</strong><span> - ' + escH(s.label) + '</span></button>';
    }).join('');
    sectorBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = sectorMenu.hidden;
      sectorMenu.hidden = !open;
      sectorBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    sectorMenu.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.hm-sector-item') : null;
      if (item) { closeSectors(); load(item.getAttribute('data-ticker')); }
    });
    document.addEventListener('click', function (e) {
      if (!sectorMenu.hidden && !e.target.closest('.hm-sectors')) closeSectors();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sectorMenu.hidden) closeSectors();
    });
  }

  /* ----- ticker suggestions (benchmarks; sectors live under the Sector ETFs box) ----- */
  var SUGGESTIONS = [
    { t: 'SPY', label: 'S&P 500' },
    { t: 'QQQ', label: 'Nasdaq 100' },
    { t: 'DIA', label: 'Dow Jones Industrial' },
    { t: 'XBI', label: 'Biotech' }
  ];
  var suggestEl = document.getElementById('hm-suggest');
  var suggestOpen = false, suggestActive = -1;

  function escH(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function suggestList() {
    var q = input.value.trim().toUpperCase();
    if (!q) return SUGGESTIONS.slice();
    return SUGGESTIONS.filter(function (s) {
      return s.t.indexOf(q) >= 0 || s.label.toUpperCase().indexOf(q) >= 0;
    });
  }

  function openSuggest() {
    var list = suggestList();
    if (!list.length) { closeSuggest(); return; }
    suggestActive = -1;
    suggestEl.innerHTML = list.map(function (s, i) {
      return '<div class="hm-suggest-item" role="option" data-ticker="' + s.t + '" data-i="' + i + '"' +
        ' id="hm-sug-' + i + '"><strong>' + escH(s.t) + '</strong><span> - ' + escH(s.label) + '</span></div>';
    }).join('');
    suggestEl.hidden = false;
    suggestOpen = true;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeSuggest() {
    suggestEl.hidden = true;
    suggestOpen = false;
    suggestActive = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function pickSuggest(t) {
    input.value = t;
    closeSuggest();
    load(t);
  }

  suggestEl.addEventListener('mousedown', function (e) {
    var item = e.target.closest ? e.target.closest('.hm-suggest-item') : null;
    if (item) { e.preventDefault(); pickSuggest(item.getAttribute('data-ticker')); }
  });

  function markActive() {
    var items = suggestEl.querySelectorAll('.hm-suggest-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === suggestActive);
    }
    if (suggestActive >= 0 && items[suggestActive]) {
      input.setAttribute('aria-activedescendant', 'hm-sug-' + suggestActive);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  input.addEventListener('focus', openSuggest);
  input.addEventListener('input', openSuggest);
  input.addEventListener('blur', function () {
    // small delay so a suggestion mousedown lands first
    setTimeout(closeSuggest, 120);
  });
  input.addEventListener('keydown', function (e) {
    if (suggestOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      var n = suggestEl.querySelectorAll('.hm-suggest-item').length;
      if (!n) return;
      suggestActive = e.key === 'ArrowDown'
        ? (suggestActive + 1) % n
        : (suggestActive - 1 + n) % n;
      markActive();
    } else if (e.key === 'Enter') {
      if (suggestOpen && suggestActive >= 0) {
        var items = suggestEl.querySelectorAll('.hm-suggest-item');
        if (items[suggestActive]) { e.preventDefault(); pickSuggest(items[suggestActive].getAttribute('data-ticker')); return; }
      }
      closeSuggest();
      goCustom();
    } else if (e.key === 'Escape' && suggestOpen) {
      e.preventDefault();
      closeSuggest();
    }
  });
  document.addEventListener('click', function (e) {
    if (suggestOpen && !e.target.closest('.hm-suggest-wrap')) closeSuggest();
  });
  function goCustom() {
    var v = input.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (!v) return;
    input.value = v;
    load(v);
  }
  goBtn.addEventListener('click', goCustom);

  var rAF = window.requestAnimationFrame || function (f) { f(); };
  rAF(function () { load('SPY'); });
})();
