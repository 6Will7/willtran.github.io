/* ============================================================
   Gallery — renders DATA/gallery.json into categorized grids
   with fast Cloudinary delivery (f_auto/q_auto, responsive
   srcsets, lazy loading, blur-up placeholders) + lightbox.
   To change photos, edit DATA/gallery.json. Nothing else needed.
   ============================================================ */

(function () {
  "use strict";

  var DATA_URL = "DATA/gallery.json";

  /* ---------- Cloudinary URL helpers ---------- */
  function clUrl(cloudName, publicId, transforms) {
    return (
      "https://res.cloudinary.com/" +
      cloudName +
      "/image/upload/" +
      transforms +
      "/" +
      publicId
    );
  }

  // Tiny blurred placeholder shown while the real image loads
  function placeholderUrl(cloudName, publicId) {
    return clUrl(cloudName, publicId, "f_auto,q_20,w_40,e_blur:400");
  }

  // Responsive thumbnail (grid). Browser picks the right size.
  function thumbSrcset(cloudName, publicId) {
    var t = "f_auto,q_auto,c_limit";
    return (
      clUrl(cloudName, publicId, t + ",w_400") +
      " 400w, " +
      clUrl(cloudName, publicId, t + ",w_800") +
      " 800w, " +
      clUrl(cloudName, publicId, t + ",w_1200") +
      " 1200w"
    );
  }

  function thumbSrc(cloudName, publicId) {
    return clUrl(cloudName, publicId, "f_auto,q_auto,c_limit,w_800");
  }

  // Full-size lightbox image, capped so phones don't download desktop files
  function fullUrl(cloudName, publicId) {
    return clUrl(cloudName, publicId, "f_auto,q_auto,c_limit,w_1600");
  }

  /* ---------- Lightbox ---------- */
  var lightbox, lightboxImage, lightboxCaption, currentPhotoSpan, totalPhotosSpan;
  var allPhotos = [];
  var cloudName = "";
  var currentIndex = 0;
  var touchStartX = 0;
  var SWIPE_THRESHOLD = 50;

  function initLightboxRefs() {
    lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lightboxImage = lightbox.querySelector(".lightbox-image");
    lightboxCaption = lightbox.querySelector(".lightbox-caption");
    currentPhotoSpan = lightbox.querySelector(".current-photo");
    totalPhotosSpan = lightbox.querySelector(".total-photos");

    lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    lightbox.querySelector(".lightbox-next").addEventListener("click", function (e) {
      e.stopPropagation();
      navigateLightbox("next");
    });
    lightbox.querySelector(".lightbox-prev").addEventListener("click", function (e) {
      e.stopPropagation();
      navigateLightbox("prev");
    });

    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox || e.target.classList.contains("lightbox-container")) {
        closeLightbox();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("active")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") navigateLightbox("next");
      if (e.key === "ArrowLeft") navigateLightbox("prev");
    });

    lightbox.addEventListener("touchstart", function (e) {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    lightbox.addEventListener("touchend", function (e) {
      var diff = touchStartX - e.changedTouches[0].screenX;
      if (Math.abs(diff) > SWIPE_THRESHOLD) {
        navigateLightbox(diff > 0 ? "next" : "prev");
      }
    }, { passive: true });
  }

  function openLightbox(index) {
    currentIndex = index;
    var photo = allPhotos[currentIndex];
    lightboxImage.src = fullUrl(cloudName, photo.id);
    lightboxImage.alt = photo.alt || "";
    lightboxCaption.textContent = photo.caption || "";
    currentPhotoSpan.textContent = currentIndex + 1;
    lightbox.classList.add("active");
    document.body.style.overflow = "hidden";
    preloadNeighbor(1);
    preloadNeighbor(-1);
  }

  function preloadNeighbor(offset) {
    var i = (currentIndex + offset + allPhotos.length) % allPhotos.length;
    var img = new Image();
    img.src = fullUrl(cloudName, allPhotos[i].id);
  }

  function closeLightbox() {
    lightbox.classList.remove("active");
    document.body.style.overflow = "";
    lightboxImage.src = "";
  }

  function navigateLightbox(direction) {
    if (direction === "next") {
      currentIndex = (currentIndex + 1) % allPhotos.length;
    } else {
      currentIndex = (currentIndex - 1 + allPhotos.length) % allPhotos.length;
    }
    openLightbox(currentIndex);
  }

  /* ---------- Rendering ---------- */
  function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Swap the blurry placeholder for the real image once it loads
  function hydrateImage(img) {
    if (img.dataset.hydrated) return;
    img.dataset.hydrated = "1";
    var real = new Image();
    real.decoding = "async";
    if (img.dataset.srcset) real.srcset = img.dataset.srcset;
    real.src = img.dataset.src;
    var done = function () {
      img.src = real.currentSrc || real.src;
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      img.classList.remove("is-loading");
    };
    if (real.complete && real.naturalWidth) done();
    else {
      real.onload = done;
      real.onerror = function () { img.classList.remove("is-loading"); };
    }
  }

  function observeImages(scope) {
    var imgs = scope.querySelectorAll("img[data-src]");
    if (!("IntersectionObserver" in window)) {
      imgs.forEach(hydrateImage);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          hydrateImage(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "400px" });
    imgs.forEach(function (img) { io.observe(img); });
  }

  function photoCard(photo, index) {
    var item = document.createElement("article");
    item.className = "gallery-item reveal";
    item.innerHTML =
      '<div class="thumb-wrap">' +
        '<img class="gallery-image is-loading" ' +
          'src="' + placeholderUrl(cloudName, photo.id) + '" ' +
          'data-src="' + thumbSrc(cloudName, photo.id) + '" ' +
          'data-srcset="' + thumbSrcset(cloudName, photo.id) + '" ' +
          'sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw" ' +
          'alt="' + escapeHtml(photo.alt) + '" ' +
          'data-index="' + index + '" ' +
          'loading="lazy" decoding="async">' +
      "</div>" +
      '<div class="gallery-caption">' + escapeHtml(photo.caption) + "</div>";
    return item;
  }

  function renderGallery(container, data) {
    cloudName = data.cloudName;
    var globalIndex = 0;

    // Jump nav (only when there is more than one section)
    if (data.categories.length > 1) {
      var jumpNav = document.createElement("div");
      jumpNav.className = "jump-nav";
      data.categories.forEach(function (section) {
        var a = document.createElement("a");
        a.href = "#" + slugify(section.title);
        a.textContent = section.title;
        jumpNav.appendChild(a);
      });
      container.appendChild(jumpNav);
    }

    data.categories.forEach(function (section) {
      var sectionId = slugify(section.title);

      var title = document.createElement("h3");
      title.id = sectionId;
      title.className = "gallery-section-title";
      title.textContent = section.title;
      container.appendChild(title);

      var grid = document.createElement("div");
      grid.className = "gallery-grid";

      section.photos.forEach(function (photo) {
        allPhotos.push(photo);
        grid.appendChild(photoCard(photo, globalIndex));
        globalIndex++;
      });

      container.appendChild(grid);
    });

    if (totalPhotosSpan) totalPhotosSpan.textContent = allPhotos.length;

    container.addEventListener("click", function (e) {
      var t = e.target;
      if (t.classList && t.classList.contains("gallery-image") && t.dataset.index != null) {
        openLightbox(parseInt(t.dataset.index, 10));
      }
    });

    observeImages(container);
    if (window.RobitReveal) window.RobitReveal.observeNew(container);
  }

  function showError(container, message) {
    container.innerHTML =
      '<div class="disclaimer-box"><h3>Gallery unavailable</h3><p>' +
      escapeHtml(message) +
      "</p></div>";
  }

  /* ---------- Featured photos (homepage) ---------- */
  function renderFeatured(container, data) {
    cloudName = data.cloudName;
    var featured = [];
    data.categories.forEach(function (section) {
      section.photos.forEach(function (photo) {
        if (photo.featured) featured.push(photo);
      });
    });
    featured.slice(0, 3).forEach(function (photo, i) {
      allPhotos.push(photo);
      var card = photoCard(photo, i);
      card.classList.add("gallery-item-link");
      card.setAttribute("role", "link");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", (photo.alt || "Photo") + " — view in gallery");
      var go = function () { window.location.href = "gallery.html"; };
      card.addEventListener("click", go);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
      container.appendChild(card);
    });
    observeImages(container);
    if (window.RobitReveal) window.RobitReveal.observeNew(container);
  }

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    initLightboxRefs();

    var galleryContainer = document.getElementById("gallery-container");
    if (galleryContainer) {
      fetch(DATA_URL)
        .then(function (res) {
          if (!res.ok) throw new Error("Could not load " + DATA_URL);
          return res.json();
        })
        .then(function (data) {
          if (!data.cloudName || !Array.isArray(data.categories)) {
            throw new Error("DATA/gallery.json is missing cloudName or categories.");
          }
          renderGallery(galleryContainer, data);
        })
        .catch(function (err) {
          showError(galleryContainer, err.message + " Check that DATA/gallery.json exists and is valid JSON.");
          console.error(err);
        });
      return;
    }

    // Homepage: render featured photos (no lightbox needed, cards link to gallery)
    var featuredGrid = document.getElementById("featured-grid");
    if (featuredGrid) {
      fetch(DATA_URL)
        .then(function (res) {
          if (!res.ok) throw new Error("Could not load " + DATA_URL);
          return res.json();
        })
        .then(function (data) {
          renderFeatured(featuredGrid, data);
        })
        .catch(function (err) {
          featuredGrid.innerHTML =
            '<p class="muted">Photos are unavailable right now. <a href="gallery.html">Visit the gallery</a>.</p>';
          console.error(err);
        });
    }
  });
})();
