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
  var lightboxContainer;
  var allPhotos = [];
  var cloudName = "";
  var currentIndex = 0;
  var SWIPE_THRESHOLD = 50;

  /* ----- Zoom & pan state ----- */
  var ZOOM_MIN = 1, ZOOM_MAX = 4, DBL_TAP_ZOOM = 2.5;
  var zoomState = { scale: 1, x: 0, y: 0 };
  var pointers = new Map();   // active pointerId -> {x, y}
  var pinchStart = null;      // {dist, scale} captured when 2nd finger lands
  var dragLast = null;        // last pos for single-pointer panning
  var downInfo = null;        // for tap / double-tap / swipe detection
  var lastTap = 0;            // timestamp of previous tap (double-tap)
  var suppressClick = false;  // set after a real pan/pinch so it can't close the lightbox

  function applyZoom() {
    lightboxImage.style.transform =
      "translate(" + zoomState.x + "px," + zoomState.y + "px) scale(" + zoomState.scale + ")";
    lightbox.classList.toggle("zoomed", zoomState.scale > 1);
  }

  function resetZoom() {
    zoomState.scale = 1; zoomState.x = 0; zoomState.y = 0;
    pointers.clear();
    pinchStart = null; dragLast = null; downInfo = null;
    suppressClick = false;
    applyZoom();
  }

  function clampPan() {
    var cw = lightboxContainer.clientWidth, ch = lightboxContainer.clientHeight;
    var iw = lightboxImage.clientWidth * zoomState.scale;
    var ih = lightboxImage.clientHeight * zoomState.scale;
    var mx = Math.max(0, (iw - cw) / 2), my = Math.max(0, (ih - ch) / 2);
    zoomState.x = Math.min(mx, Math.max(-mx, zoomState.x));
    zoomState.y = Math.min(my, Math.max(-my, zoomState.y));
  }

  // Set an absolute scale, keeping the image point under (clientX, clientY) fixed.
  function setZoomAt(clientX, clientY, newScale) {
    newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newScale));
    var s = zoomState.scale;
    if (newScale === s) return;
    // The image is flex-centered, so its untransformed center is the container center.
    var r = lightboxContainer.getBoundingClientRect();
    var cx = clientX - (r.left + r.width / 2);
    var cy = clientY - (r.top + r.height / 2);
    zoomState.x = cx - (cx - zoomState.x) * (newScale / s);
    zoomState.y = cy - (cy - zoomState.y) * (newScale / s);
    zoomState.scale = newScale;
    if (newScale === ZOOM_MIN) { zoomState.x = 0; zoomState.y = 0; }
    clampPan();
    applyZoom();
  }

  function zoomStep(dir) {
    var r = lightboxContainer.getBoundingClientRect();
    var f = dir > 0 ? 1.4 : 1 / 1.4;
    setZoomAt(r.left + r.width / 2, r.top + r.height / 2, zoomState.scale * f);
  }

  function toggleZoom(clientX, clientY) {
    setZoomAt(clientX, clientY, zoomState.scale > 1 ? ZOOM_MIN : DBL_TAP_ZOOM);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e) {
    if (!lightbox.classList.contains("active")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest && e.target.closest("button")) return; // let buttons handle themselves
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragLast = { x: e.clientX, y: e.clientY };
      downInfo = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
    } else if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinchStart = { dist: dist(pts[0], pts[1]), scale: zoomState.scale };
      dragLast = null; downInfo = null; // second finger cancels tap/swipe
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      var pts = Array.from(pointers.values());
      var d = dist(pts[0], pts[1]);
      if (d > 0 && pinchStart.dist > 0) {
        suppressClick = true;
        setZoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2,
                  pinchStart.scale * d / pinchStart.dist);
      }
      return;
    }
    if (pointers.size === 1 && dragLast) {
      var dx = e.clientX - dragLast.x, dy = e.clientY - dragLast.y;
      if (downInfo && Math.abs(e.clientX - downInfo.x) + Math.abs(e.clientY - downInfo.y) > 10) {
        downInfo.moved = true;
      }
      if (zoomState.scale > 1 && (dx !== 0 || dy !== 0)) {
        zoomState.x += dx; zoomState.y += dy;
        if (downInfo && downInfo.moved) suppressClick = true; // real drag, not a tap
        clampPan();
        applyZoom();
      }
      dragLast = { x: e.clientX, y: e.clientY };
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      if (downInfo && !downInfo.moved && Date.now() - downInfo.t < 400) {
        var now = Date.now();
        if (now - lastTap < 300) {
          toggleZoom(e.clientX, e.clientY); // double-tap / double-click
          lastTap = 0;
        } else {
          lastTap = now;
        }
      } else if (downInfo && downInfo.moved && zoomState.scale === 1) {
        var sx = e.clientX - downInfo.x, sy = e.clientY - downInfo.y;
        if (Math.abs(sx) > SWIPE_THRESHOLD && Math.abs(sx) > Math.abs(sy) * 1.5) {
          navigateLightbox(sx < 0 ? "next" : "prev");
        }
      }
      dragLast = null; downInfo = null;
    } else if (pointers.size === 1) {
      var p = pointers.values().next().value; // resume pan from the remaining finger
      dragLast = { x: p.x, y: p.y };
      downInfo = null;
    }
  }

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
      if (suppressClick) { suppressClick = false; return; }
      if (e.target === lightbox || e.target.classList.contains("lightbox-container")) {
        closeLightbox();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("active")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") navigateLightbox("next");
      if (e.key === "ArrowLeft") navigateLightbox("prev");
      if (e.key === "+" || e.key === "=") zoomStep(1);
      if (e.key === "-") zoomStep(-1);
      if (e.key === "0") resetZoom();
    });

    // Zoom & pan gestures (replaces the old touch swipe handlers)
    lightboxContainer = lightbox.querySelector(".lightbox-container");
    lightboxContainer.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    // Mouse wheel zooms toward the cursor
    lightboxContainer.addEventListener("wheel", function (e) {
      if (!lightbox.classList.contains("active")) return;
      e.preventDefault();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setZoomAt(e.clientX, e.clientY, zoomState.scale * Math.exp(-dy * 0.0016));
    }, { passive: false });

    lightboxImage.addEventListener("dragstart", function (e) { e.preventDefault(); });

    lightbox.querySelectorAll(".lightbox-zoom-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        zoomStep(btn.getAttribute("data-zoom") === "in" ? 1 : -1);
      });
    });
  }

  function openLightbox(index) {
    currentIndex = index;
    var photo = allPhotos[currentIndex];
    resetZoom();
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
    resetZoom();
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
