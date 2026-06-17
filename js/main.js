// Function to load the unified header
function loadHeader() {
  fetch('header.html')
    .then(response => response.text())
    .then(data => {
      // 1. Inject the header HTML into the placeholder
      document.getElementById('header-placeholder').innerHTML = data;

      // 2. Automatically set the "active" class based on the current page
      // Get the current file name (e.g., 'gallery.html'), default to 'index.html' if blank
      let currentPage = window.location.pathname.split('/').pop();
      if (currentPage === '') currentPage = 'index.html';

      // Find all the links we just injected
      const navLinks = document.querySelectorAll('.nav-container nav a');
      
      navLinks.forEach(link => {
        // If the link's href matches the current page, make it active
        if (link.getAttribute('href') === currentPage) {
          link.classList.add('active');
        }
      });

      // 3. Re-initialize your Theme Toggle button here!
      // (Since the button is injected dynamically, you must attach its click listener AFTER it loads)
      initThemeToggle(); 
    })
    .catch(error => console.error('Error loading header:', error));
}

// Run the loader as soon as the page opens
loadHeader();

// Make sure your theme toggle logic is wrapped in a function like this:
function initThemeToggle() {
  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      // Your existing light/dark mode switching code goes here
      document.body.classList.toggle('dark-theme');
    });
  }
}
document.addEventListener("DOMContentLoaded", () => {
      const toggleBtn = document.getElementById("theme-toggle");
      const htmlElement = document.documentElement; 

      // 1. Check if user previously saved a theme preference
      const savedTheme = localStorage.getItem("theme");
      if (savedTheme) {
        htmlElement.setAttribute("data-theme", savedTheme);
      }

      // 2. Button click logic
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          const currentTheme = htmlElement.getAttribute("data-theme");
          let newTheme;

          if (currentTheme === "dark") {
            newTheme = "light";
          } else if (currentTheme === "light") {
            newTheme = "dark";
          } else {
            // Fallback to checking the operating system preference
            const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            newTheme = systemPrefersDark ? "light" : "dark";
          }

          // Apply and save the new theme
          htmlElement.setAttribute("data-theme", newTheme);
          localStorage.setItem("theme", newTheme);
        });
      }
    });
