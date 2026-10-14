/* Private gallery manager (Will only) — reorganize, recaption, hide, delete.
 * Page is unlisted + noindex; the admin token gates every write. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var DATA_URL = '/DATA/gallery.json';
  var FIXED_CATS = ['Temples & Shrines', 'Gardens', 'Castles', 'Mount Fuji', 'City',
    'Aquarium', 'Wildlife', 'Details', 'People'];

  var tokEl = document.getElementById('mgr-token');
  var loadBtn = document.getElementById('mgr-load');
  var msgEl = document.getElementById('mgr-msg');
  var catsEl = document.getElementById('mgr-cats');
  var showHiddenEl = document.getElementById('mgr-show-hidden');

  var cloudName = 'dzya7bgz6';
  var photos = [];   // {id, thumb, caption, category, baseCategory, isUpload, deleted, position, seq}
  var edits = {};    // photo_id -> edit row
  var customCats = [];

  try { tokEl.value = sessionStorage.getItem('gallery_admin') || ''; } catch (e) {}
  function token() { return tokEl.value.trim(); }
  function setMsg(t) { msgEl.textContent = t; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function thumb(id) {
    return 'https://res.cloudinary.com/' + cloudName + '/image/upload/f_auto,q_auto,c_limit,w_400/' + id;
  }

  function api(path, body) {
    return fetch(WORKER_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    });
  }

  function saveEdit(photoId, fields, statusEl) {
    var body = { token: token(), photo_id: photoId };
    Object.keys(fields).forEach(function (k) { body[k] = fields[k]; });
    if (statusEl) statusEl.textContent = 'saving…';
    return api('/gallery/edit', body).then(function (res) {
      if (res.ok && res.j && res.j.ok) {
        if (statusEl) {
          statusEl.textContent = 'saved ✓';
          setTimeout(function () { statusEl.textContent = ''; }, 1800);
        }
        return true;
      }
      if (statusEl) statusEl.textContent = (res.j && res.j.error) || 'save failed';
      return false;
    }).catch(function () {
      if (statusEl) statusEl.textContent = 'save failed';
      return false;
    });
  }

  function allCats() {
    var seen = {}, out = FIXED_CATS.slice();
    FIXED_CATS.forEach(function (c) { seen[c] = 1; });
    customCats.forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } });
    photos.forEach(function (p) {
      if (p.category && !seen[p.category]) { seen[p.category] = 1; out.push(p.category); }
    });
    return out;
  }

  function buildPhotos(data, u) {
    photos = [];
    edits = {};
    customCats = [];
    ((u && u.edits) || []).forEach(function (e) {
      if (e && e.photo_id) edits[e.photo_id] = e;
    });
    var seq = 0;
    function addPhoto(id, baseCat, baseCap, isUpload, createdAt) {
      var e = edits[id];
      photos.push({
        id: id,
        thumb: thumb(id),
        caption: (e && e.caption !== null && e.caption !== undefined) ? e.caption : (baseCap || ''),
        category: (e && e.category) ? e.category : baseCat,
        baseCategory: baseCat,
        isUpload: !!isUpload,
        deleted: !!(e && e.deleted),
        position: (e && e.position !== null && e.position !== undefined) ? e.position : null,
        seq: seq++,
        createdAt: createdAt || 0
      });
    }
    data.categories.forEach(function (c) {
      (c.photos || []).forEach(function (p) {
        addPhoto(p.id, c.title, p.caption || '', false, 0);
      });
    });
    ((u && u.uploads) || []).forEach(function (up) {
      if (!up.public_id) return;
      if (FIXED_CATS.indexOf(up.category) < 0 && customCats.indexOf(up.category) < 0) {
        customCats.push(up.category);
      }
      addPhoto(up.public_id, up.category, up.caption || '', true, up.created_at || 0);
    });
    // Assign seq to match the gallery's default display order: within each
    // category, uploads newest-first, then base photos in file order.
    var byCat = {};
    photos.forEach(function (p) {
      (byCat[p.category] = byCat[p.category] || []).push(p);
    });
    var s = 0;
    Object.keys(byCat).forEach(function (t) {
      byCat[t].sort(function (a, b) {
        if (a.isUpload && !b.isUpload) return -1;
        if (!a.isUpload && b.isUpload) return 1;
        if (a.isUpload && b.isUpload) return b.createdAt - a.createdAt;
        return a.seq - b.seq;
      });
      byCat[t].forEach(function (p) { p.seq = s++; });
    });
  }

  function visiblePhotos() {
    var showHidden = showHiddenEl.checked;
    return photos.filter(function (p) { return showHidden || !p.deleted; });
  }

  function render() {
    catsEl.innerHTML = '';
    var cats = allCats();
    var byCat = {};
    visiblePhotos().forEach(function (p) {
      (byCat[p.category] = byCat[p.category] || []).push(p);
    });
    // Order within a category: explicit position first, then default order
    Object.keys(byCat).forEach(function (t) {
      byCat[t].sort(function (a, b) {
        var pa = a.position === null ? 1e9 : a.position;
        var pb = b.position === null ? 1e9 : b.position;
        return (pa - pb) || (a.seq - b.seq);
      });
    });
    // Category order: fixed first, then customs in first-seen order
    var ordered = cats.filter(function (t) { return byCat[t] && byCat[t].length; });
    if (!ordered.length) {
      catsEl.innerHTML = '<p class="rest-sub">No photos to show.</p>';
      return;
    }
    ordered.forEach(function (title) {
      var sec = document.createElement('div');
      sec.className = 'mgr-cat';
      var h = document.createElement('h3');
      h.textContent = title + ' (' + byCat[title].length + ')';
      sec.appendChild(h);
      var list = document.createElement('div');
      list.className = 'mgr-list';
      byCat[title].forEach(function (p, idx) {
        list.appendChild(rowEl(p, idx, byCat[title].length));
      });
      sec.appendChild(list);
      catsEl.appendChild(sec);
    });
  }

  function rowEl(p, idx, total) {
    var div = document.createElement('div');
    div.className = 'mgr-item';
    div.setAttribute('data-photo-id', p.id);

    var img = document.createElement('img');
    img.src = p.thumb;
    img.alt = '';
    img.loading = 'lazy';
    div.appendChild(img);

    var fields = document.createElement('div');
    fields.className = 'mgr-fields';

    var tags = document.createElement('div');
    tags.style.cssText = 'display:flex;gap:0.35rem;align-items:center;';
    if (p.isUpload) {
      var ut = document.createElement('span');
      ut.className = 'mgr-upload-tag';
      ut.textContent = 'upload';
      tags.appendChild(ut);
    }
    if (p.deleted) {
      var ht = document.createElement('span');
      ht.className = 'mgr-hidden-tag';
      ht.textContent = 'hidden';
      tags.appendChild(ht);
    }
    var saved = document.createElement('span');
    saved.className = 'mgr-saved';
    tags.appendChild(saved);
    fields.appendChild(tags);

    var capInput = document.createElement('input');
    capInput.type = 'text';
    capInput.value = p.caption;
    capInput.placeholder = 'Caption';
    capInput.maxLength = 140;
    capInput.setAttribute('aria-label', 'Caption');
    var capTimer = null;
    capInput.addEventListener('input', function () {
      clearTimeout(capTimer);
      capTimer = setTimeout(function () {
        saveEdit(p.id, { caption: capInput.value.trim() }, saved).then(function (ok) {
          if (ok) p.caption = capInput.value.trim();
        });
      }, 800);
    });
    fields.appendChild(capInput);

    var row = document.createElement('div');
    row.className = 'mgr-row';
    var catSel = document.createElement('select');
    catSel.setAttribute('aria-label', 'Category');
    allCats().forEach(function (c) {
      var o = document.createElement('option');
      o.textContent = c;
      if (c === p.category) o.selected = true;
      catSel.appendChild(o);
    });
    catSel.addEventListener('change', function () {
      var nc = catSel.value;
      saveEdit(p.id, { category: nc }, saved).then(function (ok) {
        if (ok) { p.category = nc; render(); }
      });
    });
    row.appendChild(catSel);
    fields.appendChild(row);
    div.appendChild(fields);

    var actions = document.createElement('div');
    actions.className = 'mgr-actions';

    var up = document.createElement('button');
    up.className = 'mgr-btn';
    up.textContent = '↑';
    up.title = 'Move up';
    up.setAttribute('aria-label', 'Move photo up');
    up.disabled = idx === 0;
    up.addEventListener('click', function () { movePhoto(p, -1); });
    actions.appendChild(up);

    var down = document.createElement('button');
    down.className = 'mgr-btn';
    down.textContent = '↓';
    down.title = 'Move down';
    down.setAttribute('aria-label', 'Move photo down');
    down.disabled = idx === total - 1;
    down.addEventListener('click', function () { movePhoto(p, 1); });
    actions.appendChild(down);

    if (p.isUpload) {
      var del = document.createElement('button');
      del.className = 'mgr-btn danger';
      del.textContent = 'Delete';
      del.addEventListener('click', function () {
        if (!confirm('Delete this upload permanently (also removes it from Cloudinary)?')) return;
        setMsg('Deleting…');
        api('/gallery/upload-delete', { token: token(), public_id: p.id }).then(function (res) {
          if (res.ok && res.j && res.j.ok) {
            photos = photos.filter(function (x) { return x.id !== p.id; });
            setMsg('Deleted.');
            render();
          } else {
            setMsg((res.j && res.j.error) || 'Delete failed.');
          }
        });
      });
      actions.appendChild(del);
    } else {
      var hide = document.createElement('button');
      hide.className = 'mgr-btn' + (p.deleted ? '' : ' danger');
      hide.textContent = p.deleted ? 'Unhide' : 'Hide';
      hide.addEventListener('click', function () {
        saveEdit(p.id, { deleted: !p.deleted }, saved).then(function (ok) {
          if (ok) {
            p.deleted = !p.deleted;
            edits[p.id] = edits[p.id] || {};
            edits[p.id].deleted = p.deleted ? 1 : 0;
            setMsg(p.deleted ? 'Hidden from the gallery.' : 'Visible in the gallery again.');
            render();
          }
        });
      });
      actions.appendChild(hide);
    }
    div.appendChild(actions);
    return div;
  }

  function movePhoto(p, dir) {
    // Reorder within the photo's current category; positions are assigned to
    // the whole category so the order sticks.
    var list = visiblePhotos().filter(function (x) { return x.category === p.category; });
    list.sort(function (a, b) {
      var pa = a.position === null ? 1e9 : a.position;
      var pb = b.position === null ? 1e9 : b.position;
      return (pa - pb) || (a.seq - b.seq);
    });
    var i = list.indexOf(p);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    setMsg('Saving new order…');
    var saves = list.map(function (photo, idx) {
      photo.position = idx;
      return saveEdit(photo.id, { position: idx }, null);
    });
    Promise.all(saves).then(function (results) {
      if (results.every(Boolean)) {
        setMsg('Order saved.');
        list.forEach(function (photo) {
          edits[photo.id] = edits[photo.id] || {};
          edits[photo.id].position = photo.position;
        });
      } else {
        setMsg('Some moves failed to save — reload to see actual order.');
      }
      render();
    });
  }

  function load() {
    var tok = token();
    if (!tok) { setMsg('Enter your admin token first.'); tokEl.focus(); return; }
    setMsg('Loading…');
    catsEl.innerHTML = '<div class="loader-center"><div class="spinner" role="status" aria-label="Loading"></div></div>';
    Promise.all([
      fetch(DATA_URL).then(function (r) {
        if (!r.ok) throw new Error('gallery.json missing');
        return r.json();
      }),
      fetch(WORKER_URL + '/gallery/uploads?t=' + Date.now()).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; })
    ]).then(function (res) {
      var data = res[0], u = res[1];
      if (!data.cloudName || !Array.isArray(data.categories)) throw new Error('bad gallery.json');
      cloudName = data.cloudName;
      try { sessionStorage.setItem('gallery_admin', tok); } catch (e) {}
      buildPhotos(data, u);
      setMsg(photos.length + ' photos loaded.');
      render();
    }).catch(function (e) {
      setMsg('Load failed: ' + (e.message || 'check your connection.'));
      catsEl.innerHTML = '';
    });
  }

  loadBtn.addEventListener('click', load);
  showHiddenEl.addEventListener('change', render);
  tokEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') load();
  });
})();
