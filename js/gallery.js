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
  var lightboxContainer, likeBtn, likeCountEl;
  var likeCounts = {}, likedByMe = {};
  var WORKER = "https://willtran-stocks-proxy.willtran98.workers.dev";
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

    // Like + share wiring
    likeBtn = lightbox.querySelector(".lb-like");
    likeCountEl = lightbox.querySelector(".lb-like-count");
    if (likeBtn) likeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleLike(currentPhotoId());
    });
    lightbox.querySelectorAll(".lb-share").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        sharePhoto(btn.getAttribute("data-share"), btn);
      });
    });
  }

  function currentPhotoId() {
    var p = allPhotos[currentIndex];
    return p ? p.id : null;
  }

  function photoShareUrl(photoId) {
    return "https://willtran.org/gallery.html?photo=" + encodeURIComponent(photoId);
  }

  function sharePhoto(kind, btn) {
    var pid = currentPhotoId();
    if (!pid) return;
    var url = photoShareUrl(pid);
    var photo = allPhotos[currentIndex];
    var text = (photo && photo.caption ? photo.caption + " — " : "") + "Photo by Will Tran";
    if (kind === "x") {
      window.open("https://twitter.com/intent/tweet?url=" + encodeURIComponent(url) +
        "&text=" + encodeURIComponent(text), "_blank", "noopener,width=560,height=460");
    } else if (kind === "facebook") {
      window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url),
        "_blank", "noopener,width=560,height=460");
    } else {
      // copy link
      var done = function (ok) {
        if (!btn) return;
        var orig = btn.textContent;
        btn.textContent = ok ? "Copied!" : "Copy failed";
        setTimeout(function () { btn.textContent = orig; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
      } else {
        var ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try { done(document.execCommand("copy")); } catch (e) { done(false); }
        document.body.removeChild(ta);
      }
    }
  }

  function refreshLikeUI() {
    var pid = currentPhotoId();
    if (!likeBtn || !pid) return;
    var n = likeCounts[pid] || 0;
    likeCountEl.textContent = String(n);
    var liked = !!likedByMe[pid];
    likeBtn.classList.toggle("liked", liked);
    likeBtn.setAttribute("aria-pressed", liked ? "true" : "false");
    likeBtn.setAttribute("aria-label", liked ? "Unlike this photo" : "Like this photo");
  }

  function toggleLike(pid) {
    if (!pid || toggleLike.busy) return;
    toggleLike.busy = true;
    fetch(WORKER + "/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_id: pid })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          likeCounts[pid] = j.count;
          if (j.liked) likedByMe[pid] = 1; else delete likedByMe[pid];
          refreshLikeUI();
          syncBadge(pid);
        }
      })
      .catch(function () {})
      .then(function () { toggleLike.busy = false; });
  }

  function syncBadge(pid) {
    var badge = document.querySelector('.like-badge[data-photo-id="' + CSS.escape(pid) + '"]');
    if (!badge) return;
    var n = badge.querySelector(".lb-n");
    if (n) n.textContent = String(likeCounts[pid] || 0);
    badge.classList.toggle("liked", !!likedByMe[pid]);
    badge.setAttribute("aria-pressed", likedByMe[pid] ? "true" : "false");
  }

  function loadLikeCounts() {
    if (!allPhotos.length) return;
    var ids = allPhotos.map(function (p) { return p.id; }).slice(0, 200);
    fetch(WORKER + "/likes?ids=" + ids.map(encodeURIComponent).join(","))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j) return;
        likeCounts = j.counts || {};
        (j.mine || []).forEach(function (id) { likedByMe[id] = 1; });
        allPhotos.forEach(function (p) { syncBadge(p.id); });
        refreshLikeUI();
      })
      .catch(function () {});
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
    refreshLikeUI();
    try {
      history.replaceState(null, "", "gallery.html?photo=" + encodeURIComponent(photo.id));
    } catch (e) {}
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
    try {
      history.replaceState(null, "", "gallery.html");
    } catch (e) {}
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



  function photoCard(photo, index) {
    var item = document.createElement("article");
    item.className = "gallery-item"; // no .reveal: cards must be visible even if the scroll observer misfires (mobile Safari)
    item.innerHTML =
      '<div class="thumb-wrap">' +
        '<img class="gallery-image" ' +
          'src="' + thumbSrc(cloudName, photo.id) + '" ' +
          'srcset="' + thumbSrcset(cloudName, photo.id) + '" ' +
          'sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw" ' +
          'alt="' + escapeHtml(photo.alt) + '" ' +
          'data-index="' + index + '" ' +
          'loading="lazy" decoding="async">' +
        '<button class="like-badge" data-photo-id="' + escapeHtml(photo.id) + '" ' +
          'aria-label="Like this photo"><span class="lb-heart" aria-hidden="true">♥</span> ' +
          '<span class="lb-n">0</span></button>' +
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
      var badge = t.classList && t.classList.contains("like-badge") ? t :
        (t.closest ? t.closest(".like-badge") : null);
      if (badge && badge.dataset.photoId) {
        e.stopPropagation();
        toggleLike(badge.dataset.photoId);
        return;
      }
      if (t.classList && t.classList.contains("gallery-image") && t.dataset.index != null) {
        openLightbox(parseInt(t.dataset.index, 10));
      }
    });

    // Deep link: ?photo=<id> opens the lightbox on that photo
    loadLikeCounts();
    try {
      var deepId = new URLSearchParams(window.location.search).get("photo");
      if (deepId) {
        for (var di = 0; di < allPhotos.length; di++) {
          if (allPhotos[di].id === deepId) { openLightbox(di); break; }
        }
      }
    } catch (e) {}

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
    if (window.RobitReveal) window.RobitReveal.observeNew(container);
  }

  /* ---------- Gallery data: base JSON + uploads + Will's management edits ---------- */
  function buildGalleryData(data, u) {
    var uploads = (u && u.uploads) || [];
    var edits = {};
    ((u && u.edits) || []).forEach(function (e) {
      if (e && e.photo_id) edits[e.photo_id] = e;
    });
    // Merge uploads into categories (newest first), creating sections as needed
    uploads.slice().reverse().forEach(function (up) {
      if (!up.public_id || !up.category) return;
      var cat = null;
      data.categories.forEach(function (c) { if (c.title === up.category) cat = c; });
      if (!cat) {
        cat = { title: up.category, photos: [] };
        data.categories.push(cat);
      }
      var cap = up.caption || "";
      cat.photos.unshift({ id: up.public_id, alt: cap || "Gallery photo", caption: cap });
    });
    // Apply management edits: recategorize, recaption, hide, reorder
    var catOrder = [];
    var seenCat = {};
    data.categories.forEach(function (c) { catOrder.push(c.title); seenCat[c.title] = true; });
    var byCat = {};
    var seq = 0;
    data.categories.forEach(function (c) {
      c.photos.forEach(function (p) {
        var e = edits[p.id];
        if (e && e.deleted) return;
        var title = (e && e.category) ? e.category : c.title;
        var cap = (e && e.caption !== null && e.caption !== undefined) ? e.caption : p.caption;
        if (!byCat[title]) {
          byCat[title] = [];
          if (!seenCat[title]) { seenCat[title] = true; catOrder.push(title); }
        }
        byCat[title].push({
          id: p.id,
          alt: cap || p.alt || "Gallery photo",
          caption: cap || "",
          pos: (e && e.position !== null && e.position !== undefined) ? e.position : null,
          seq: seq++
        });
      });
    });
    var finalCats = [];
    catOrder.forEach(function (title) {
      var photos = (byCat[title] || []).sort(function (a, b) {
        var pa = a.pos === null ? 1e9 : a.pos;
        var pb = b.pos === null ? 1e9 : b.pos;
        return (pa - pb) || (a.seq - b.seq);
      });
      if (photos.length) finalCats.push({ title: title, photos: photos });
    });
    data.categories = finalCats;
    return data;
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
          // Merge Will's uploads + management edits (newest first) into categories.
          return fetch("https://willtran-stocks-proxy.willtran98.workers.dev/gallery/uploads")
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; })
            .then(function (u) {
              renderGallery(galleryContainer, buildGalleryData(data, u));
            });
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
          updatePhotoStat(data);
        })
        .catch(function (err) {
          featuredGrid.innerHTML =
            '<p class="muted">Photos are unavailable right now. <a href="gallery.html">Visit the gallery</a>.</p>';
          console.error(err);
        });
    }
  });

  // Homepage hero stat: total photos = JSON + Will's uploads - hidden ones (auto-updates).
  function updatePhotoStat(data) {
    var el = document.getElementById("stat-photos");
    if (!el || !data.categories) return;
    var base = 0;
    data.categories.forEach(function (c) { base += (c.photos || []).length; });
    fetch("https://willtran-stocks-proxy.willtran98.workers.dev/gallery/uploads")
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (u) {
        var n = (u && u.uploads) ? u.uploads.length : 0;
        var hidden = 0;
        ((u && u.edits) || []).forEach(function (e) { if (e && e.deleted) hidden++; });
        el.textContent = String(Math.max(0, base + n - hidden));
      });
  }
})();
