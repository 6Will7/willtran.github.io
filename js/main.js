/* =========================================
   1. IMMEDIATE THEME CHECK (Prevents Flashing)
   ========================================= */
// Check for saved theme immediately as the script loads
const savedTheme = localStorage.getItem("theme");
if (savedTheme) {
  document.documentElement.setAttribute("data-theme", savedTheme);
}

/* =========================================
   2. UNIFIED HEADER INJECTION
   ========================================= */
function loadHeader() {
  fetch('header.html')
    .then(response => response.text())
    .then(data => {
      // Inject the header
      document.getElementById('header-placeholder').innerHTML = data;

      // Automatically set the "active" class
      let currentPage = window.location.pathname.split('/').pop();
      if (currentPage === '') currentPage = 'index.html';

      const navLinks = document.querySelectorAll('.nav-container nav a');
      navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPage) {
          link.classList.add('active');
        }
      });

      // Initialize the toggle button NOW that it actually exists on the page
      initThemeToggle(); 
    })
    .catch(error => console.error('Error loading header:', error));
}

/* =========================================
   3. THEME TOGGLE LOGIC
   ========================================= */
function initThemeToggle() {
  const toggleBtn = document.getElementById("theme-toggle");
  const htmlElement = document.documentElement; 

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      // Check current theme, default to 'light' if none is set
      const currentTheme = htmlElement.getAttribute("data-theme") || "light";
      const newTheme = currentTheme === "dark" ? "light" : "dark";

      // Apply and save the new theme
      htmlElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
    });
  }
}

// Kick off the header load!
loadHeader();
