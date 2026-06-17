/* =========================================
   1. IMMEDIATE THEME CHECK (Prevents Flashing)
   ========================================= */
// Runs instantly as the script loads to prevent a white flash
const savedTheme = localStorage.getItem("theme");
if (savedTheme) {
  document.documentElement.setAttribute("data-theme", savedTheme);
}
/* =========================================
     3. UNIFIED HEADER INJECTION
     ========================================= */
  async function loadHeader() {
    try {
      // FIXED: Using explicit relative directory pathing for GitHub environment stability
      const response = await fetch('./header.html');
      if (!response.ok) throw new Error("Header file not found");
      
      const data = await response.text();
      document.getElementById('header-placeholder').innerHTML = data;

      // FIXED: Safely extract page path and normalize empty root endpoints to index.html
      let path = window.location.pathname;
      let currentPage = path.split('/').pop();
      if (!currentPage || currentPage === "") {
        currentPage = 'index.html';
      }

      const navLinks = document.querySelectorAll('.nav-container nav a');
      navLinks.forEach(link => {
        // Strip out leading paths from href attributes to get a clean match
        let linkHref = link.getAttribute('href').split('/').pop();
        if (linkHref === currentPage) {
          link.classList.add('active');
        }
      });

      // Initialize the toggle button NOW that the header exists
      initThemeToggle(); 

    } catch (error) {
      console.error('Error loading header:', error);
    }
  }

  /* =========================================
     4. UNIFIED FOOTER INJECTION
     ========================================= */
  async function loadFooter() {
    try {
      // FIXED: Explicit relative file fetching setup
      const response = await fetch('./footer.html');
      if (!response.ok) throw new Error("Footer file not found");
      
      const data = await response.text();
      document.getElementById('footer-placeholder').innerHTML = data;

      // Automatically set the copyright to the current year
      const yearSpan = document.getElementById('current-year');
      if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
      }
    } catch (error) {
      console.error('Error loading footer:', error);
    }
  }

  /* =========================================
     5. THEME TOGGLE LOGIC
     ========================================= */
  function initThemeToggle() {
    const toggleBtn = document.getElementById("theme-toggle");
    const htmlElement = document.documentElement; 

    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const currentTheme = htmlElement.getAttribute("data-theme") || "light";
        const newTheme = currentTheme === "dark" ? "light" : "dark";

        htmlElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("theme", newTheme);
      });
    }
  }
});
