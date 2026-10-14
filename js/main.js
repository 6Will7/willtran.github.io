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
  loadHeader();
  loadFooter();
  initReveal();
  initBackToTop();
  initAccentSwitcher();

  /* ----- Accent color switcher (persisted) ----- */
  var ACCENTS = {
    violet:  { accent: "#7c3aed", hover: "#6d28d9", partner: "#2563eb" },
    emerald: { accent: "#059669", hover: "#047857", partner: "#0ea5e9" },
    amber:   { accent: "#d97706", hover: "#b45309", partner: "#dc2626" },
    rose:    { accent: "#e11d48", hover: "#be1239", partner: "#f59e0b" }
  };

  function applyAccent(name) {
    var root = document.documentElement;
    if (!name || name === "default" || !ACCENTS[name]) {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-hover");
      root.style.removeProperty("--color-accent-2");
      root.style.removeProperty("--color-accent-text");
      try { localStorage.removeItem("wt-accent"); } catch (e) {}
      name = "default";
    } else {
      var a = ACCENTS[name];
      root.style.setProperty("--color-accent", a.accent);
      root.style.setProperty("--color-accent-hover", a.hover);
      root.style.setProperty("--color-accent-2", a.partner);
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
  function initNavDropdown() {
    var drop = document.querySelector(".nav-drop");
    if (!drop || drop.dataset.init) return;
    drop.dataset.init = "1";
    var btn = drop.querySelector(".nav-dropbtn");
    var topLink = drop.querySelector(".nav-droplink");
    if (drop.querySelector(".nav-dropmenu a.active")) topLink.classList.add("active");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = drop.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function () {
      drop.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        drop.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      }
    });
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
