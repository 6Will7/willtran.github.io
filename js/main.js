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
    emerald: { accent: "#059669", hover: "#047857", partner: "#0ea5e9", third: "#a3e635" },
    amber:   { accent: "#d97706", hover: "#b45309", partner: "#dc2626", third: "#f59e0b" },
    rose:    { accent: "#e11d48", hover: "#be1239", partner: "#f59e0b", third: "#7c3aed" }
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
  function initNavDropdown() { initJumpMenu(); }

  /* ----- Jump-to menu: one searchable, grouped all-pages overlay ----- */
  var JUMP_GROUPS = [
    { name: "Create & Share", items: [
      { t: "Gallery", h: "/gallery.html", d: "Photos from the Bay Area and beyond.", k: "photos pictures images camera" },
      { t: "Recipes", h: "/recipes.html", d: "Things I've cooked and written down.", k: "cooking food dishes kitchen" },
      { t: "Restaurants", h: "/restaurants/", d: "Bay Area spots worth eating at.", k: "food dining eat places" },
      { t: "Guestbook", h: "/guestbook/", d: "Leave a note for me and future visitors.", k: "sign hello comment visitors" }
    ] },
    { name: "Watch", items: [
      { t: "Movies", h: "/movies/", d: "What my friends and I have been watching.", k: "films diary reviews ratings watchlist" },
      { t: "Videos", h: "/videos.html", d: "Featured videos, some of my own.", k: "watch clips films featured" }
    ] },
    { name: "Tools", items: [
      { t: "Calculator", h: "/calculator/", d: "Natural-language calculator with conversions and bond math.", k: "math compute convert units" },
      { t: "BART Tracker", h: "/bart/", d: "Real-time departures, service alerts, station map, nearest stations.", k: "bart train transit commute muni vta map stations" }
    ] },
    { name: "Markets", items: [
      { t: "Markets Overview", h: "/markets/", d: "All the market tools in one place.", k: "stocks finance tools" },
      { t: "Stocks", h: "/stocks/", d: "Live quotes, charts, SEC filings, and insider trades.", k: "quotes charts tickers watchlist prices" },
      { t: "Heat Map", h: "/heatmap/", d: "Sector heat map built from official ETF holdings.", k: "sectors sp500 etf treemap" },
      { t: "Rates", h: "/rates/", d: "Treasury yields and the yield curve, for any date.", k: "treasury bonds yield curve interest" },
      { t: "SEC Search", h: "/sec-search/", d: "Full-text search across SEC filings.", k: "edgar filings 10-k 10-q search" },
      { t: "Economic Data", h: "/economic-data/", d: "CPI, payrolls, FOMC — the U.S. release calendar.", k: "cpi jobs fomc calendar releases macro" },
      { t: "Correlation", h: "/correlation/", d: "How closely do two stocks move together?", k: "calculator compare pair beta covariance" }
    ] },
    { name: "Site", items: [
      { t: "Home", h: "/", d: "Back to the front page.", k: "index start main" },
      { t: "Sitemap", h: "/sitemap/", d: "Every page on the site, on one page.", k: "all pages directory index list" }
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
        '<p class="jump-hint">↑ ↓ to move · Enter to go · Esc to close</p>' +
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

  function renderJump(filter) {
    var list = document.getElementById("jump-list");
    if (!list) return;
    var words = (filter || "").toLowerCase().split(/\s+/).filter(Boolean);
    var html = "";
    jumpLinks = [];
    JUMP_GROUPS.forEach(function (g) {
      var items = g.items.filter(function (it) {
        var hay = (it.t + " " + it.d + " " + it.k).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
      if (!items.length) return;
      html += '<div class="jump-group"><h4>' + g.name + "</h4>";
      items.forEach(function (it) {
        html += '<a class="jump-item" href="' + it.h + '"><span class="jump-item-t">' +
          it.t + '</span><span class="jump-item-d">' + it.d + "</span></a>";
      });
      html += "</div>";
    });
    list.innerHTML = html || '<p class="jump-none">No pages match — try a shorter search.</p>';
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
