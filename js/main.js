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