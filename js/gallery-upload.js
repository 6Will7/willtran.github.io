/* Private gallery uploader (Will only) — drag & drop straight to Cloudinary,
 * then registers the photo in the worker's D1 so it appears in the gallery.
 * Page is unlisted + noindex; the admin token gates every write. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var CATS = ['Temples & Shrines', 'Gardens', 'Castles', 'Mount Fuji', 'City',
    'Aquarium', 'Wildlife', 'Details', 'People'];
  var MAX_BYTES = 10 * 1024 * 1024;

  var tokEl = document.getElementById('up-token');
  var dropEl = document.getElementById('up-drop');
  var fileEl = document.getElementById('up-files');
  var queueEl = document.getElementById('up-queue');
  var allBtn = document.getElementById('up-all');
  var msgEl = document.getElementById('up-msg');

  var items = []; // {file, cat, cap, statusEl, done}

  try { tokEl.value = sessionStorage.getItem('gallery_admin') || ''; } catch (e) {}

  function token() { return tokEl.value.trim(); }
  function setMsg(t) { msgEl.textContent = t; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var NEW_OPT = '+ New category…';
  var customCats = []; // session-added category names, shared across items

  function allCats() { return CATS.concat(customCats); }

  // Pull already-used custom categories from the worker so they persist across visits
  fetch(WORKER_URL + '/gallery/uploads')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (u) {
      var seen = {};
      ((u && u.uploads) || []).forEach(function (up) {
        var c = (up.category || '').trim();
        if (c && CATS.indexOf(c) < 0 && !seen[c]) { seen[c] = 1; customCats.push(c); }
      });
      if (customCats.length) refreshCatOptions();
    })
    .catch(function () {});

  function catOptions(selected) {
    return allCats().map(function (c) {
      return '<option' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('') + '<option value="__new"' + (selected === '__new' ? ' selected' : '') + '>' +
      esc(NEW_OPT) + '</option>';
  }

  function refreshCatOptions() {
    items.forEach(function (it) {
      if (!it.catEl) return;
      // Rebuild every select, preserving each item's current choice
      // (including "__new" for items still naming a category).
      it.catEl.innerHTML = catOptions(it.catEl.value);
    });
  }

  function wireNewCat(item, div) {
    var sel = item.catEl;
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'New category name';
    input.maxLength = 40;
    input.setAttribute('aria-label', 'New category name');
    input.style.display = 'none';
    input.style.marginTop = '0.4rem';
    sel.parentNode.insertBefore(input, sel.nextSibling);
    item.newCatEl = input;
    sel.addEventListener('change', function () {
      input.style.display = sel.value === '__new' ? '' : 'none';
      if (sel.value === '__new') input.focus();
    });
    function commit() {
      var name = input.value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
      if (!name) return;
      if (allCats().indexOf(name) < 0) {
        customCats.push(name);
        refreshCatOptions();
      }
      sel.value = name;
      input.style.display = 'none';
      input.value = '';
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
  }

  function addFiles(files) {
    var added = 0;
    Array.prototype.forEach.call(files, function (f) {
      if (!f.type || f.type.indexOf('image/') !== 0) return;
      if (f.size > MAX_BYTES) { setMsg(f.name + ' is over 10 MB — skipped.'); return; }
      if (items.some(function (it) { return it.file.name === f.name && it.file.size === f.size; })) return;
      var url = URL.createObjectURL(f);
      var div = document.createElement('div');
      div.className = 'up-item';
      div.innerHTML =
        '<img alt="">' +
        '<div class="up-fields">' +
          '<div class="up-row"><span class="up-name">' + esc(f.name) + '</span>' +
          '<span class="up-status waiting">queued</span></div>' +
          '<select aria-label="Category">' +
            catOptions('Details') +
          '</select>' +
          '<input type="text" placeholder="Caption (optional)" maxlength="140" aria-label="Caption">' +
        '</div>';
      div.querySelector('img').src = url;
      queueEl.appendChild(div);
      var item = {
        file: f,
        statusEl: div.querySelector('.up-status'),
        catEl: div.querySelector('select'),
        capEl: div.querySelector('input[placeholder^="Caption"]'),
        done: false
      };
      wireNewCat(item, div);
      items.push(item);
      added++;
    });
    if (added) { setMsg(''); allBtn.disabled = false; }
  }

  dropEl.addEventListener('click', function () { fileEl.click(); });
  dropEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); }
  });
  fileEl.addEventListener('change', function () { addFiles(fileEl.files); fileEl.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove('drag'); });
  });
  dropEl.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  function setStatus(it, cls, text) {
    it.statusEl.className = 'up-status ' + cls;
    it.statusEl.textContent = text;
  }

  function resolveCat(it) {
    var v = it.catEl.value;
    if (v !== '__new') return v;
    // Custom name typed but not yet committed (Enter/blur) — take it now
    var name = (it.newCatEl ? it.newCatEl.value : '').trim()
      .replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
    if (!name) return null;
    if (allCats().indexOf(name) < 0) { customCats.push(name); refreshCatOptions(); }
    it.catEl.value = name;
    if (it.newCatEl) { it.newCatEl.style.display = 'none'; it.newCatEl.value = ''; }
    return name;
  }

  function signUpload(tok) {
    return fetch(WORKER_URL + '/gallery/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok })
    }).then(function (r) {
      if (r.status === 401) throw new Error('Wrong admin token.');
      if (r.status === 429) throw new Error('Too many attempts — try again later.');
      if (!r.ok) throw new Error('Could not sign upload.');
      return r.json();
    });
  }

  function uploadToCloudinary(file, sig) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', sig.api_key);
    fd.append('timestamp', String(sig.timestamp));
    fd.append('signature', sig.signature);
    fd.append('folder', sig.folder);
    return fetch('https://api.cloudinary.com/v1_1/' + sig.cloud_name + '/image/upload', {
      method: 'POST',
      body: fd
    }).then(function (r) {
      if (!r.ok) throw new Error('Cloudinary upload failed.');
      return r.json();
    });
  }

  function registerPhoto(tok, publicId, category, caption) {
    return fetch(WORKER_URL + '/gallery/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tok, public_id: publicId, category: category, caption: caption })
    }).then(function (r) {
      if (!r.ok) throw new Error('Could not register photo.');
      return r.json();
    });
  }

  allBtn.addEventListener('click', function () {
    var tok = token();
    if (!tok) { setMsg('Enter your admin token first.'); tokEl.focus(); return; }
    var pending = items.filter(function (it) { return !it.done; });
    if (!pending.length) return;
    allBtn.disabled = true;
    setMsg('Uploading ' + pending.length + ' photo' + (pending.length > 1 ? 's' : '') + '…');
    // One signature covers the batch (timestamp valid for ~1h server-side).
    signUpload(tok).then(function (sig) {
      try { sessionStorage.setItem('gallery_admin', tok); } catch (e) {}
      var chain = Promise.resolve();
      pending.forEach(function (it) {
        chain = chain.then(function () {
          setStatus(it, 'uploading', 'uploading…');
          var cat = resolveCat(it);
          if (!cat) {
            setStatus(it, 'error', 'name the new category first');
            return;
          }
          return uploadToCloudinary(it.file, sig).then(function (up) {
            setStatus(it, 'uploading', 'saving…');
            return registerPhoto(tok, up.public_id, cat, it.capEl.value.trim());
          }).then(function () {
            it.done = true;
            setStatus(it, 'done', 'live in gallery ✓');
          }).catch(function (e) {
            setStatus(it, 'error', e.message || 'failed');
          });
        });
      });
      return chain;
    }).then(function () {
      var failed = pending.filter(function (it) { return !it.done; }).length;
      setMsg(failed ? failed + ' failed — fix the token or retry.' : 'All live in the gallery.');
      if (items.some(function (it) { return !it.done; })) allBtn.disabled = false;
    }).catch(function (e) {
      setMsg(e.message || 'Upload failed.');
      allBtn.disabled = false;
    });
  });
})();
