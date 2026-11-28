/* ============================================================
   main.js — shared site behavior
   1. Theme restore (runs immediately to prevent flash)
   2. Header / footer injection + active nav link
   3. Theme toggle
   4. Scroll reveal animations (exposes window.RobitReveal)
   5. Back-to-top button
   ============================================================ */

/* ---------- 1. IMMEDIATE THEME CHECK (prevents flash) ---------- */
(function () {
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("theme"); } catch (e) {}
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
})();

/* ---------- 2–5. AFTER PAGE LOAD ---------- */
document.addEventListener("DOMContentLoaded", function () {
  /* ----- Accent color switcher data (must be defined before init calls below) ----- */
  var ACCENTS = {
    violet:  { accent: "#7c3aed", hover: "#6d28d9", partner: "#2563eb", third: "#ec4899" },
    royal:   { accent: "#7D2CFF", hover: "#6d28d9", partner: "#2563eb", third: "#F5B916" },
    emerald: { accent: "#059669", hover: "#047857", partner: "#0ea5e9", third: "#a3e635" },
    amber:   { accent: "#d97706", hover: "#b45309", partner: "#dc2626", third: "#f59e0b" },
    rose:    { accent: "#e11d48", hover: "#be1239", partner: "#f59e0b", third: "#7c3aed" },
    frutiger: { accent: "#0072C6", hover: "#005A9E", partner: "#58B02C", third: "#FFC21F" }
  };

  loadHeader();
  loadFooter();
  initReveal();
  initBackToTop();
  initAccentSwitcher();

  /* ----- Accent color switcher (persisted) ----- */

  function applyAccent(name) {
    var root = document.documentElement;
    if (!name || name === "default" || !ACCENTS[name]) {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-hover");
      root.style.removeProperty("--color-accent-2");
      root.style.removeProperty("--color-accent-3");
      root.style.removeProperty("--color-accent-text");
      try { localStorage.removeItem("wt-accent"); } catch (e) {}
      name = "default";
    } else {
      var a = ACCENTS[name];
      root.style.setProperty("--color-accent", a.accent);
      root.style.setProperty("--color-accent-hover", a.hover);
      root.style.setProperty("--color-accent-2", a.partner);
      root.style.setProperty("--color-accent-3", a.third);
      root.style.setProperty("--color-accent-text", "#ffffff");
      try { localStorage.setItem("wt-accent", name); } catch (e) {}
    }
    document.querySelectorAll(".swatch").forEach(function (s) {
      s.setAttribute("aria-checked", s.getAttribute("data-accent") === name ? "true" : "false");
    });
  }

  function initAccentSwitcher() {
    var saved = null;
    try { saved = localStorage.getItem("wt-accent"); } catch (e) {}
    if (saved && ACCENTS[saved]) applyAccent(saved);
    document.querySelectorAll(".swatch").forEach(function (s) {
      s.addEventListener("click", function () { applyAccent(s.getAttribute("data-accent")); });
    });
  }
  /* ----- Markets dropdown (works for build-inlined and runtime-fetched header) ----- */
  function initNavDropdown() { initJumpMenu(); initCommandBar(); }

  /* ----- Command bar: backtick opens a terminal-style prompt -----
     Own vocabulary, plain words — deliberately not the two-letter
     mnemonics other terminals use. `aapl overview` jumps to a ticker
     view; `movers` or `screener` go straight to a page; `help` lists
     every command. */
  var CMD_TICKER = [
    { c: 'overview', d: 'One-screen snapshot: ratios, returns, analysts' },
    { c: 'chart', d: 'Price chart' },
    { c: 'financials', d: 'Quarterly financials' },
    { c: 'filings', d: 'SEC filings' },
    { c: 'holders', d: 'Institutional holders (13F)' },
    { c: 'earnings', d: 'Earnings surprises and next report' },
    { c: 'news', d: 'Latest news' },
    { c: 'dividends', d: 'Dividend history' },
    { c: 'history', d: 'Daily prices table and download' },
    { c: 'compare', d: 'Compare against other tickers' },
    { c: 'quote', d: 'Current quote' }
  ];
  var CMD_BARE = [
    { c: 'movers', d: "Today's gainers, losers, most active", h: '/movers/' },
    { c: 'indices', d: 'World indices', h: '/movers/?view=indices' },
    { c: 'screener', d: 'Filter stocks by valuation, growth, yield', h: '/screener/' },
    { c: 'heatmap', d: 'S&P 500 sector heat map', h: '/heatmap/' },
    { c: 'wire', d: 'News, filings and earnings stream', h: '/wire/' },
    { c: 'earnings', d: 'Who reports this week', h: '/earnings/' },
    { c: 'rates', d: 'Treasury yields and curve', h: '/rates/' },
    { c: 'correlation', d: 'How closely do two stocks move?', h: '/correlation/' },
    { c: 'calculator', d: 'Natural-language calculator', h: '/calculator/' },
    { c: 'bart', d: 'BART departures', h: '/bart/' },
    { c: 'gallery', d: 'Photos', h: '/gallery.html' },
    { c: 'movies', d: 'Movies and friends diaries', h: '/movies/' },
    { c: 'changelog', d: "What's new on the site", h: '/changelog/' },
    { c: 'sitemap', d: 'Every page on the site', h: '/sitemap/' },
    { c: 'help', d: 'List all commands' }
  ];
  var cmdBuilt = false, cmdSel = 0, cmdItems = [], cmdGicsLoading = false;

  function ensureGics(cb) {
    if (typeof GICS !== 'undefined') { cb(); return; }
    if (cmdGicsLoading) {
      var t = setInterval(function () {
        if (typeof GICS !== 'undefined') { clearInterval(t); cb(); }
      }, 200);
      return;
    }
    cmdGicsLoading = true;
    var s = document.createElement('script');
    s.src = '/js/gics.js?v=20260929b';
    s.onload = function () { cb(); };
    s.onerror = function () { cb(); };
    document.head.appendChild(s);
  }

  function initCommandBar() {
    if (cmdBuilt) return;
    cmdBuilt = true;
    var overlay = document.createElement('div');
    overlay.className = 'jump-overlay cmd-overlay';
    overlay.id = 'cmd-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Command bar');
    overlay.innerHTML =
      '<div class="jump-panel cmd-panel">' +
        '<div class="jump-searchrow cmd-searchrow">' +
          '<span class="cmd-prompt" aria-hidden="true">&gt;</span>' +
          '<input id="cmd-input" type="text" placeholder="aapl overview · movers · screener · help" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command">' +
          '<button type="button" id="cmd-close" class="jump-close" aria-label="Close command bar">✕</button>' +
        '</div>' +
        '<div id="cmd-list" class="jump-list cmd-list"></div>' +
        '<p class="jump-hint">↑ ↓ to move · Enter to run · Esc to close · type <b>help</b> for all commands</p>' +
      '</div>';
    document.body.appendChild(overlay);
    var input = overlay.querySelector('#cmd-input');
    input.addEventListener('input', function () { renderCmd(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCmd(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveCmd(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runCmd(input.value); }
      else if (e.key === 'Escape') { closeCmd(); }
    });
    overlay.querySelector('#cmd-close').addEventListener('click', closeCmd);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeCmd(); });
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        e.preventDefault();
        if (overlay.classList.contains('open')) closeCmd(); else openCmd();
      } else if (e.key === 'Escape' && overlay.classList.contains('open')) {
        closeCmd();
      }
    });
  }

  function cmdIsTicker(tok) {
    return /^[A-Z0-9.\-]{1,6}$/.test(tok);
  }

  // Build the suggestion list for the current input. Each item: {t, d, href}
  // (href null = informational line, Enter does nothing).
  function cmdSuggestions(q) {
    var toks = (q || '').trim().split(/\s+/).filter(Boolean);
    var items = [];
    if (!toks.length) {
      CMD_TICKER.slice(0, 5).forEach(function (c) {
        items.push({ t: 'AAPL ' + c.c, d: c.d, href: '/stocks/?symbol=AAPL&view=' + c.c });
      });
      CMD_BARE.slice(0, 5).forEach(function (b) {
        items.push({ t: b.c, d: b.d, href: b.h });
      });
      return items;
    }
    var first = toks[0].toLowerCase();
    if (first === 'help') {
      CMD_TICKER.forEach(function (c) {
        items.push({ t: 'TICKER ' + c.c, d: c.d, href: null });
      });
      CMD_BARE.forEach(function (b) {
        items.push({ t: b.c, d: b.d, href: b.h || null });
      });
      return items;
    }
    if (first === 'compare') {
      var rest = toks.slice(1).map(function (x) { return x.toUpperCase(); })
        .filter(cmdIsTicker);
      if (rest.length) {
        items.push({ t: 'compare ' + rest.join(' '), d: 'Chart these tickers on one return scale',
          href: '/compare/?symbols=' + rest.join(',') });
      } else {
        items.push({ t: 'compare …', d: 'Add tickers: compare aapl msft nvda', href: null });
      }
      return items;
    }
    if (toks.length >= 2 && cmdIsTicker(toks[0].toUpperCase())) {
      var sym = toks[0].toUpperCase();
      var want = toks[1].toLowerCase();
      CMD_TICKER.filter(function (c) { return c.c.indexOf(want) === 0; })
        .forEach(function (c) {
          var href = c.c === 'compare'
            ? '/compare/?symbols=' + sym
            : '/stocks/?symbol=' + sym + '&view=' + c.c;
          items.push({ t: sym + ' ' + c.c, d: c.d, href: href });
        });
      if (!items.length) items.push({ t: sym + ' ' + want, d: 'No such view — try overview, chart, holders…', href: null });
      return items;
    }
    // Single token: bare commands by prefix, then tickers by prefix.
    CMD_BARE.filter(function (b) { return b.c.indexOf(first) === 0; })
      .forEach(function (b) { items.push({ t: b.c, d: b.d, href: b.h || null }); });
    if (cmdIsTicker(toks[0].toUpperCase()) && typeof GICS !== 'undefined') {
      var pref = toks[0].toUpperCase();
      Object.keys(GICS).filter(function (k) { return k.indexOf(pref) === 0; })
        .slice(0, 6).forEach(function (k) {
          items.push({ t: k, d: (GICS[k].s || '') + (GICS[k].i ? ' · ' + GICS[k].i : '') +
            ' — open quote', href: '/stocks/?symbol=' + k });
        });
    }
    return items;
  }

  function renderCmd(q) {
    var list = document.getElementById('cmd-list');
    if (!list) return;
    cmdItems = cmdSuggestions(q);
    var html = '';
    if (!cmdItems.length) {
      html = '<p class="jump-none">No matches — try <b>help</b>.</p>';
    } else {
      cmdItems.forEach(function (it) {
        html += '<a class="jump-item cmd-item" href="' + (it.href || '#') + '">' +
          '<span class="jump-item-t">' + jumpEsc(it.t) + '</span>' +
          '<span class="jump-item-d">' + jumpEsc(it.d) + '</span></a>';
      });
    }
    list.innerHTML = html;
    cmdSel = 0;
    markCmdSel();
    var links = list.querySelectorAll('.jump-item');
    links.forEach(function (a, i) {
      a.addEventListener('mouseenter', function () { cmdSel = i; markCmdSel(); });
      a.addEventListener('click', function (e) {
        var it = cmdItems[i];
        if (!it || !it.href) { e.preventDefault(); return; }
        // let the href navigate; nothing else to do
      });
    });
    if (q && q.trim() && typeof GICS === 'undefined') {
      ensureGics(function () {
        var ov = document.getElementById('cmd-overlay');
        if (ov && ov.classList.contains('open')) {
          var inp = document.getElementById('cmd-input');
          renderCmd(inp ? inp.value : '');
        }
      });
    }
  }

  function markCmdSel() {
    var links = document.querySelectorAll('#cmd-list .jump-item');
    links.forEach(function (a, i) { a.classList.toggle('sel', i === cmdSel); });
    var a = links[cmdSel];
    if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
  }
  function moveCmd(d) {
    if (!cmdItems.length) return;
    cmdSel = (cmdSel + d + cmdItems.length) % cmdItems.length;
    markCmdSel();
  }

  function runCmd(q) {
    var toks = (q || '').trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    if (toks[0].toLowerCase() === 'help') { renderCmd('help'); return; }
    renderCmd(q);
    var it = cmdItems[cmdSel];
    if (it && it.href) { window.location.href = it.href; return; }
    // Raw parse fallback: a lone ticker goes to its quote.
    if (toks.length === 1 && cmdIsTicker(toks[0].toUpperCase())) {
      window.location.href = '/stocks/?symbol=' + toks[0].toUpperCase();
    }
  }

  function openCmd() {
    initCommandBar();
    var overlay = document.getElementById('cmd-overlay');
    if (!overlay) return;
    renderCmd('');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    var input = document.getElementById('cmd-input');
    if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 30); }
  }
  function closeCmd() {
    var overlay = document.getElementById('cmd-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* ----- Jump-to menu: one searchable, grouped all-pages overlay ----- */
  var JUMP_GROUPS = [
    { name: "Create & Share", items: [
      { t: "Gallery", h: "/gallery.html", d: "Photos from the Bay Area and beyond.", k: "photos pictures images camera" },
      { t: "Recipes", h: "/recipes.html", d: "Things I've cooked and written down.", k: "cooking food dishes kitchen" },
      { t: "Restaurants", h: "/restaurants/", d: "Bay Area spots worth eating at.", k: "food dining eat places" },
      { t: "Guestbook", h: "/guestbook/", d: "Leave a note for me and future visitors.", k: "sign hello comment visitors" },
      { t: "Suggestions", h: "/suggestions/", d: "Suggest something — a movie, a restaurant, a feature.", k: "suggest idea feedback box request" }
    ] },
    { name: "Watch", items: [
      { t: "Movies", h: "/movies/", d: "What my friends and I have been watching.", k: "films diary reviews ratings watchlist" },
      { t: "What to Watch", h: "/movies/watch/", d: "Popular movies by streaming service — Netflix, Prime Video, Max, Hulu.", k: "streaming netflix prime max hulu watch providers" },
      { t: "Videos", h: "/videos.html", d: "Featured videos, some of my own.", k: "watch clips films featured" }
    ] },
    { name: "Tools", items: [
      { t: "Calculator", h: "/calculator/", d: "Natural-language calculator with conversions and bond math.", k: "math compute convert units" },
      { t: "BART Tracker", h: "/bart/", d: "Real-time departures, service alerts, station map, nearest stations.", k: "bart train transit commute muni vta map stations" }
    ] },
    { name: "Markets", items: [
      { t: "Markets Overview", h: "/markets/", d: "All the market tools in one place.", k: "stocks finance tools" },
      { t: "Stocks", h: "/stocks/", d: "Live quotes, charts, SEC filings, and insider trades.", k: "quotes charts tickers watchlist prices" },
      { t: "Movers", h: "/movers/", d: "Today's gainers, losers, most active, plus world indices.", k: "gainers losers most active market movers indices" },
      { t: "Screener", h: "/screener/", d: "Filter the 3,002-ticker universe by valuation, growth and yield.", k: "screen filter stocks value growth dividend pe" },
      { t: "Compare", h: "/compare/", d: "Chart several tickers on one normalized return scale.", k: "compare chart tickers returns normalized" },
      { t: "The Wire", h: "/wire/", d: "News, filings and earnings for your tickers, in one stream.", k: "wire news stream headlines earnings regnewswire feed" },
      { t: "Earnings Week", h: "/earnings/", d: "Who reports this week, and what the Street expects.", k: "earnings calendar reports eps estimates week" },
      { t: "Heat Map", h: "/heatmap/", d: "Sector heat map built from official ETF holdings.", k: "sectors sp500 etf treemap" },
      { t: "Rates", h: "/rates/", d: "Treasury yields and the yield curve, for any date.", k: "treasury bonds yield curve interest" },
      { t: "SEC Search", h: "/sec-search/", d: "Full-text search across SEC filings.", k: "edgar filings 10-k 10-q search" },
      { t: "Economic Data", h: "/economic-data/", d: "CPI, payrolls, FOMC — the U.S. release calendar.", k: "cpi jobs fomc calendar releases macro" },
      { t: "Correlation", h: "/correlation/", d: "How closely do two stocks move together?", k: "calculator compare pair beta covariance" }
    ] },
    { name: "Site", items: [
      { t: "Home", h: "/", d: "Back to the front page.", k: "index start main" },
      { t: "Sitemap", h: "/sitemap/", d: "Every page on the site, on one page.", k: "all pages directory index list" },
      { t: "Changelog", h: "/changelog/", d: "What's new — features and changes, newest first.", k: "whats new updates history changes releases" }
    ] }
  ];
  var jumpBuilt = false, jumpSel = 0, jumpLinks = [];

  function initJumpMenu() {
    var openBtn = document.getElementById("jump-open");
    if (openBtn && !openBtn.dataset.init) {
      openBtn.dataset.init = "1";
      openBtn.addEventListener("click", openJump);
    }
    if (jumpBuilt) return;
    jumpBuilt = true;

    var overlay = document.createElement("div");
    overlay.className = "jump-overlay";
    overlay.id = "jump-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "All pages");
    overlay.innerHTML =
      '<div class="jump-panel">' +
        '<div class="jump-searchrow">' +
          '<input id="jump-search" type="text" placeholder="Jump to… try &quot;bart&quot; or &quot;stocks&quot;" autocomplete="off" aria-label="Search pages">' +
          '<button type="button" id="jump-close" class="jump-close" aria-label="Close menu">✕</button>' +
        '</div>' +
        '<div id="jump-list" class="jump-list"></div>' +
        '<p class="jump-hint">↑ ↓ to move · Enter to go · Esc to close · backtick ` opens the command bar</p>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector("#jump-search");
    input.addEventListener("input", function () { renderJump(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); moveJump(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveJump(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var a = jumpLinks[jumpSel];
        if (a) window.location.href = a.getAttribute("href");
      }
    });
    overlay.querySelector("#jump-close").addEventListener("click", closeJump);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) closeJump(); });
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (overlay.classList.contains("open")) closeJump(); else openJump();
      } else if (e.key === "Escape" && overlay.classList.contains("open")) {
        closeJump();
      }
    });
  }

  /* ----- Jump content search: recipes, restaurants, logged movies, BART stations, photo captions -----
     Loaded lazily on first menu open; results merge under the page groups.
     Content fields are user-generated, so they are HTML-escaped on render. */
  var JUMP_WORKER = "https://willtran-stocks-proxy.willtran98.workers.dev";
  var jumpContent = null;
  function jumpEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function jumpRerenderIfOpen() {
    var ov = document.getElementById("jump-overlay");
    if (ov && ov.classList.contains("open")) {
      var inp = document.getElementById("jump-search");
      renderJump(inp ? inp.value : "");
    }
  }
  var JUMP_STATIONS = [
    ['12TH', '12th St / Oakland City Center'], ['16TH', '16th St Mission'],
    ['19TH', '19th St / Oakland'], ['24TH', '24th St Mission'],
    ['ANTC', 'Antioch'], ['ASHB', 'Ashby'], ['BALB', 'Balboa Park'], ['BAYF', 'Bay Fair'],
    ['BERY', 'Berryessa / North San José'], ['CAST', 'Castro Valley'], ['CIVC', 'Civic Center'],
    ['COLM', 'Colma'], ['COLS', 'Coliseum'], ['CONC', 'Concord'], ['DALY', 'Daly City'],
    ['DBRK', 'Downtown Berkeley'], ['DELN', 'El Cerrito del Norte'], ['PLZA', 'El Cerrito Plaza'],
    ['DUBL', 'Dublin / Pleasanton'], ['EMBR', 'Embarcadero'], ['FRMT', 'Fremont'],
    ['FTVL', 'Fruitvale'], ['GLEN', 'Glen Park'], ['HAYW', 'Hayward'], ['LAFY', 'Lafayette'],
    ['LAKE', 'Lake Merritt'], ['MCAR', 'MacArthur'], ['MLBR', 'Millbrae'], ['MLPT', 'Milpitas'],
    ['MONT', 'Montgomery St'], ['NBRK', 'North Berkeley'], ['NCON', 'North Concord / Martinez'],
    ['OAKL', "Oakland Int'l Airport"], ['ORIN', 'Orinda'], ['PCTR', 'Pittsburg Center'],
    ['PHIL', 'Pleasant Hill / Contra Costa Centre'], ['PITT', 'Pittsburg / Bay Point'],
    ['POWL', 'Powell St'], ['RICH', 'Richmond'], ['ROCK', 'Rockridge'], ['SBRN', 'San Bruno'],
    ['SFIA', "San Francisco Int'l Airport"], ['SANL', 'San Leandro'], ['SHAY', 'South Hayward'],
    ['SSAN', 'South San Francisco'], ['UCTY', 'Union City'],
    ['WARM', 'Warm Springs / South Fremont'], ['WCRK', 'Walnut Creek'],
    ['WDUB', 'West Dublin / Pleasanton'], ['WOAK', 'West Oakland']
  ];
  function ensureJumpContent() {
    if (jumpContent) return;
    jumpContent = { recipes: [], restaurants: [], movies: [], stations: [], photos: [] };
    JUMP_STATIONS.forEach(function (s) {
      jumpContent.stations.push({
        t: s[1], d: "BART station",
        h: "/bart/?station=" + s[0],
        hay: (s[1] + " " + s[0] + " bart station train departures").toLowerCase()
      });
    });
    Promise.all([
      fetch("/data/recipes.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(JUMP_WORKER + "/recipes/edits").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var data = res[0];
      if (!data) return;
      var byId = {};
      (data.categories || []).forEach(function (c) {
        (c.recipes || []).forEach(function (r) {
          byId[r.id] = { t: r.title || "", prep: r.prep || "", cook: r.cook || "" };
        });
      });
      ((res[1] && res[1].edits) || []).forEach(function (e) {
        if (!e || !e.recipe_id) return;
        if (e.deleted) { delete byId[e.recipe_id]; return; }
        if (!byId[e.recipe_id] && e.is_new) {
          byId[e.recipe_id] = { t: e.title || "Untitled", prep: e.prep || "", cook: e.cook || "" };
        } else if (byId[e.recipe_id] && e.title) {
          byId[e.recipe_id].t = e.title;
        }
      });
      Object.keys(byId).forEach(function (id) {
        var r = byId[id];
        var bits = [];
        if (r.prep) bits.push("Prep " + r.prep);
        if (r.cook) bits.push("Cook " + r.cook);
        jumpContent.recipes.push({
          t: r.t, d: "Recipe" + (bits.length ? " · " + bits.join(" · ") : ""),
          h: "/recipes.html#" + id, hay: (r.t + " recipe food").toLowerCase()
        });
      });
      jumpRerenderIfOpen();
    });
    fetch(JUMP_WORKER + "/restaurants").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        ((j && j.restaurants) || []).forEach(function (r) {
          jumpContent.restaurants.push({
            t: r.name || "",
            d: [r.cuisine, r.neighborhood].filter(Boolean).join(" · ") || "Restaurant",
            h: "/restaurants/",
            hay: ((r.name || "") + " " + (r.cuisine || "") + " " + (r.neighborhood || "") + " restaurant food").toLowerCase()
          });
        });
        jumpRerenderIfOpen();
      }).catch(function () {});
    fetch(JUMP_WORKER + "/movies/feed?limit=100").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var byMovie = {};
        ((j && j.logs) || []).forEach(function (l) {
          var m = byMovie[l.tmdb_id];
          if (!m) m = byMovie[l.tmdb_id] = { t: l.title || "", year: l.year || "", best: 0, names: [] };
          if (l.rating > m.best) m.best = l.rating;
          if (l.name && m.names.indexOf(l.name) < 0) m.names.push(l.name);
        });
        Object.keys(byMovie).forEach(function (id) {
          var m = byMovie[id];
          jumpContent.movies.push({
            t: m.t + (m.year ? " (" + m.year + ")" : ""),
            d: "Movie · ★ " + m.best.toFixed(1) + " · logged by " + m.names.slice(0, 3).join(", ") +
              (m.names.length > 3 ? " +" + (m.names.length - 3) : ""),
            h: "/movies/?movie=" + id,
            hay: (m.t + " movie film").toLowerCase()
          });
        });
        jumpRerenderIfOpen();
      }).catch(function () {});
    Promise.all([
      fetch("/DATA/gallery.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(JUMP_WORKER + "/gallery/uploads").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var data = res[0];
      if (!data) return;
      var edits = {};
      ((res[1] && res[1].edits) || []).forEach(function (e) { if (e && e.photo_id) edits[e.photo_id] = e; });
      function addPhoto(id, caption, alt, catTitle) {
        var e = edits[id];
        if (e && e.deleted) return;
        var cap = (e && e.caption != null) ? e.caption : (caption || "");
        var title = (e && e.category) ? e.category : (catTitle || "Gallery");
        var label = cap || alt || "";
        if (!label) return;
        jumpContent.photos.push({
          t: label,
          d: "Photo · " + title,
          h: "/gallery.html?photo=" + encodeURIComponent(id),
          hay: (label + " " + (alt || "") + " photo gallery picture").toLowerCase()
        });
      }
      (data.categories || []).forEach(function (c) {
        (c.photos || []).forEach(function (p) { addPhoto(p.id, p.caption, p.alt, c.title); });
      });
      ((res[1] && res[1].uploads) || []).forEach(function (up) {
        if (up.public_id) addPhoto(up.public_id, up.caption, up.caption, up.category);
      });
      jumpRerenderIfOpen();
    });
  }

  function renderJump(filter) {
    var list = document.getElementById("jump-list");
    if (!list) return;
    var words = (filter || "").toLowerCase().split(/\s+/).filter(Boolean);
    var html = "";
    jumpLinks = [];
    function itemHtml(it, escIt) {
      return '<a class="jump-item" href="' + it.h + '"><span class="jump-item-t">' +
        (escIt ? jumpEsc(it.t) : it.t) + '</span><span class="jump-item-d">' +
        (escIt ? jumpEsc(it.d) : it.d) + "</span></a>";
    }
    function groupHtml(name, items, escIt) {
      if (!items.length) return "";
      var s = '<div class="jump-group"><h4>' + name + "</h4>";
      items.forEach(function (it) { s += itemHtml(it, escIt); });
      return s + "</div>";
    }
    JUMP_GROUPS.forEach(function (g) {
      var items = g.items.filter(function (it) {
        var hay = (it.t + " " + it.d + " " + it.k).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
      html += groupHtml(g.name, items, false);
    });
    if (words.length && jumpContent) {
      [["Recipes", jumpContent.recipes], ["Restaurants", jumpContent.restaurants],
       ["Movies", jumpContent.movies], ["BART Stations", jumpContent.stations],
       ["Photos", jumpContent.photos]].forEach(function (pair) {
        var items = pair[1].filter(function (it) {
          return words.every(function (w) { return it.hay.indexOf(w) >= 0; });
        }).slice(0, 5);
        html += groupHtml(pair[0], items, true);
      });
    }
    list.innerHTML = html || '<p class="jump-none">No matches — try a shorter search.</p>';
    jumpLinks = Array.prototype.slice.call(list.querySelectorAll(".jump-item"));
    jumpSel = 0;
    markJumpSel();
    jumpLinks.forEach(function (a, i) {
      a.addEventListener("mouseenter", function () { jumpSel = i; markJumpSel(); });
    });
  }

  function markJumpSel() {
    jumpLinks.forEach(function (a, i) { a.classList.toggle("sel", i === jumpSel); });
    var a = jumpLinks[jumpSel];
    if (a && a.scrollIntoView) a.scrollIntoView({ block: "nearest" });
  }
  function moveJump(d) {
    if (!jumpLinks.length) return;
    jumpSel = (jumpSel + d + jumpLinks.length) % jumpLinks.length;
    markJumpSel();
  }
  function openJump() {
    initJumpMenu();
    ensureJumpContent();
    var overlay = document.getElementById("jump-overlay");
    if (!overlay) return;
    renderJump("");
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    var input = document.getElementById("jump-search");
    if (input) { input.value = ""; setTimeout(function () { input.focus(); }, 30); }
  }
  function closeJump() {
    var overlay = document.getElementById("jump-overlay");
    if (!overlay) return;
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    var btn = document.getElementById("jump-open");
    if (btn) btn.focus();
  }

  /* ----- 2. Header injection ----- */
  function loadHeader() {
    var placeholder = document.getElementById("header-placeholder");
    if (!placeholder) { initThemeToggle(); initNavDropdown(); return; } // page has its own hardcoded header
    fetch("/header.html")
      .then(function (response) {
        if (!response.ok) throw new Error("Header file not found");
        return response.text();
      })
      .then(function (data) {
        placeholder.innerHTML = data;

        // Highlight the active nav link (trailing-slash tolerant for /calculator/)
        var path = window.location.pathname.replace(/\/+$/, "");
        var currentPage = path.split("/").pop() || "index.html";
        document.querySelectorAll(".nav-container nav a").forEach(function (link) {
          var linkHref = link.getAttribute("href").replace(/\/+$/, "").split("/").pop() || "index.html";
          if (linkHref === currentPage) link.classList.add("active");
        });

        initThemeToggle();
        initNavDropdown();
      })
      .catch(function (error) {
        console.error("Error loading header:", error);
      });
  }

  /* ----- Footer injection ----- */
  function loadFooter() {
    var placeholder = document.getElementById("footer-placeholder");
    if (!placeholder) return; // page has its own hardcoded footer
    fetch("/footer.html")
      .then(function (response) {
        if (!response.ok) throw new Error("Footer file not found");
        return response.text();
      })
      .then(function (data) {
        placeholder.innerHTML = data;
        var yearSpan = document.getElementById("current-year");
        if (yearSpan) yearSpan.textContent = new Date().getFullYear();
      })
      .catch(function (error) {
        console.error("Error loading footer:", error);
      });
  }

  /* ----- 3. Theme toggle ----- */
  function initThemeToggle() {
    var toggleBtn = document.getElementById("theme-toggle");
    var htmlElement = document.documentElement;
    if (!toggleBtn) return;
    toggleBtn.addEventListener("click", function () {
      var currentTheme = htmlElement.getAttribute("data-theme") || "light";
      var newTheme = currentTheme === "dark" ? "light" : "dark";
      htmlElement.setAttribute("data-theme", newTheme);
      try { localStorage.setItem("theme", newTheme); } catch (e) {}
    });
  }

  /* ----- 4. Scroll reveal ----- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("revealed"); });
      window.RobitReveal = { observeNew: function () {} };
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

    els.forEach(function (el) { observer.observe(el); });

    // Failsafe: if the observer never fires (quirky mobile browsers),
    // don't leave content invisible forever.
    setTimeout(function () {
      document.querySelectorAll(".reveal:not(.revealed)").forEach(function (el) {
        el.classList.add("revealed");
      });
    }, 2500);

    // Lets dynamically-rendered content (gallery cards) join the reveal
    window.RobitReveal = {
      observeNew: function (scope) {
        if (!scope || !scope.querySelectorAll) return;
        scope.querySelectorAll(".reveal:not(.revealed)").forEach(function (el) {
          observer.observe(el);
        });
      }
    };
  }

  /* ----- 5. Back to top ----- */
  function initBackToTop() {
    var btn = document.createElement("button");
    btn.className = "back-to-top-btn";
    btn.setAttribute("aria-label", "Back to top");
    btn.innerHTML = "&uarr;";
    document.body.appendChild(btn);

    var onScroll = function () {
      btn.classList.toggle("visible", window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
});
