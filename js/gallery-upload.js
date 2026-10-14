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
      return { '&': '&amp;', '&lt;': '&lt;', '&gt;': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
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
            CATS.map(function (c) { return '<option' + (c === 'Details' ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
          '</select>' +
          '<input type="text" placeholder="Caption (optional)" maxlength="140" aria-label="Caption">' +
        '</div>';
      div.querySelector('img').src = url;
      queueEl.appendChild(div);
      items.push({
        file: f,
        statusEl: div.querySelector('.up-status'),
        catEl: div.querySelector('select'),
        capEl: div.querySelector('input'),
        done: false
      });
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
          return uploadToCloudinary(it.file, sig).then(function (up) {
            setStatus(it, 'uploading', 'saving…');
            return registerPhoto(tok, up.public_id, it.catEl.value, it.capEl.value.trim());
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
