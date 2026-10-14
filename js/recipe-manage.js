/* Recipe manager — edit/add/reorganize/hide recipes. Overrides stored in D1 via /recipes/edit. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var DATA_URL = '/data/recipes.json';

  var tokEl = document.getElementById('rmgr-token');
  var loadBtn = document.getElementById('rmgr-load');
  var addBtn = document.getElementById('rmgr-add');
  var showHiddenEl = document.getElementById('rmgr-show-hidden');
  var msgEl = document.getElementById('rmgr-msg');
  var catsEl = document.getElementById('rmgr-cats');

  try { tokEl.value = sessionStorage.getItem('recipe_admin') || sessionStorage.getItem('gallery_admin') || ''; } catch (e) {}

  var categories = []; // {id, title, icon, recipes: [...]}
  var customCats = []; // manager-created category ids
  var edits = {};      // recipe_id -> edit row (for is_new tracking)

  function token() { return tokEl.value.trim(); }
  function setMsg(t) { msgEl.textContent = t; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugify(s) {
    return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'category';
  }
  function titleCase(s) {
    return String(s).split(/[-_]+/).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  function parseList(v) {
    if (Array.isArray(v)) return v.slice();
    if (!v) return [];
    try { var p = JSON.parse(v); if (Array.isArray(p)) return p; } catch (e) {}
    return String(v).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function api(path, body) {
    return fetch(WORKER_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j && j.ok, j: j }; }); });
  }

  function saveEdit(recipeId, fields, savedEl) {
    if (savedEl) savedEl.textContent = 'saving…';
    var body = { token: token(), recipe_id: recipeId };
    Object.keys(fields).forEach(function (k) { body[k] = fields[k]; });
    // Preserve is_new flag so the worker knows this is a manager-added recipe
    var e = edits[recipeId];
    if (e && e.is_new) body.is_new = 1;
    return api('/recipes/edit', body).then(function (res) {
      if (savedEl) savedEl.textContent = res.ok ? 'saved' : ('error: ' + ((res.j && res.j.error) || 'failed'));
      if (res.ok && savedEl) setTimeout(function () { savedEl.textContent = ''; }, 1500);
      return res.ok;
    }).catch(function () {
      if (savedEl) savedEl.textContent = 'save failed';
      return false;
    });
  }

  function allCatIds() {
    var seen = {}, out = [];
    categories.forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; out.push(c.id); } });
    customCats.forEach(function (id) { if (!seen[id]) { seen[id] = 1; out.push(id); } });
    return out;
  }
  function catTitle(id) {
    var found = null;
    categories.forEach(function (c) { if (c.id === id) found = c.title; });
    return found || titleCase(id);
  }

  function applyEdits(data, editRows) {
    edits = {};
    editRows.forEach(function (e) { if (e && e.recipe_id) edits[e.recipe_id] = e; });
    var byId = {};
    categories = (data.categories || []).map(function (c) {
      return { id: c.id, title: c.title, icon: c.icon, recipes: (c.recipes || []).map(function (r) {
        return {
          id: r.id, title: r.title, prep: r.prep || '', cook: r.cook || '',
          ingredients: (r.ingredients || []).slice(), instructions: (r.instructions || []).slice(),
          category: c.id, isNew: false, deleted: false, position: null
        };
      }) };
    });
    categories.forEach(function (c) {
      c.recipes.forEach(function (r) { byId[r.id] = r; });
    });
    // New recipes from overrides
    Object.keys(edits).forEach(function (rid) {
      var e = edits[rid];
      if (!e.is_new || e.deleted || byId[rid]) return;
      var catId = e.category || 'uncategorized';
      var r = {
        id: rid, title: e.title || 'Untitled', prep: e.prep || '', cook: e.cook || '',
        ingredients: parseList(e.ingredients), instructions: parseList(e.instructions),
        category: catId, isNew: true, deleted: false, position: e.position
      };
      getCat(catId).recipes.push(r);
      byId[rid] = r;
    });
    // Field edits, moves, deletes
    Object.keys(edits).forEach(function (rid) {
      var e = edits[rid];
      var r = byId[rid];
      if (!r || e.is_new) return; // new recipes already built above
      if (e.deleted) { r.deleted = true; return; }
      if (e.title) r.title = e.title;
      if (e.prep !== null && e.prep !== undefined) r.prep = e.prep;
      if (e.cook !== null && e.cook !== undefined) r.cook = e.cook;
      if (e.ingredients) r.ingredients = parseList(e.ingredients);
      if (e.instructions) r.instructions = parseList(e.instructions);
      if (e.position !== null && e.position !== undefined) r.position = e.position;
      if (e.category && e.category !== r.category) {
        var old = getCat(r.category);
        old.recipes = old.recipes.filter(function (x) { return x.id !== rid; });
        r.category = e.category;
        getCat(e.category).recipes.push(r);
      }
    });
    // Sort by position within each category
    categories.forEach(function (c) {
      c.recipes.sort(function (a, b) {
        return (a.position === null || a.position === undefined ? 1e9 : a.position) -
               (b.position === null || b.position === undefined ? 1e9 : b.position);
      });
    });
  }

  function getCat(id) {
    var found = null;
    categories.forEach(function (c) { if (c.id === id) found = c; });
    if (!found) {
      found = { id: id, title: titleCase(id), icon: '🍽️', recipes: [] };
      categories.push(found);
    }
    return found;
  }

  function load() {
    var tok = token();
    if (!tok) { setMsg('Enter your admin token first.'); tokEl.focus(); return; }
    setMsg('Loading…');
    catsEl.innerHTML = '<div class="loader-center"><div class="spinner" role="status" aria-label="Loading"></div></div>';
    Promise.all([
      fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('recipes.json missing'); return r.json(); }),
      fetch(WORKER_URL + '/recipes/edits').then(function (r) { return r.ok ? r.json() : { edits: [] }; }).catch(function () { return { edits: [] }; })
    ]).then(function (res) {
      try { sessionStorage.setItem('recipe_admin', tok); } catch (e) {}
      customCats = [];
      applyEdits(res[0], (res[1] && res[1].edits) || []);
      // Track custom categories from edits
      Object.keys(edits).forEach(function (rid) {
        var c = edits[rid].category;
        if (c && customCats.indexOf(c) < 0) {
          var known = false;
          categories.forEach(function (cat) { if (cat.id === c) known = true; });
          if (!known) customCats.push(c);
        }
      });
      setMsg(categories.reduce(function (n, c) { return n + c.recipes.length; }, 0) + ' recipes loaded.');
      render();
    }).catch(function () {
      setMsg('Failed to load — check your connection.');
      catsEl.innerHTML = '';
    });
  }

  function render() {
    catsEl.innerHTML = '';
    var showHidden = showHiddenEl.checked;
    categories.forEach(function (cat) {
      var visible = cat.recipes.filter(function (r) { return showHidden || !r.deleted; });
      if (!visible.length && !showHidden) return;
      var catDiv = document.createElement('div');
      catDiv.className = 'rmgr-cat';
      var h = document.createElement('h3');
      h.textContent = (cat.icon || '🍽️') + ' ' + cat.title + ' (' + visible.length + ')';
      catDiv.appendChild(h);
      visible.forEach(function (r) { catDiv.appendChild(recipeCard(r, cat)); });
      catsEl.appendChild(catDiv);
    });
    if (!catsEl.children.length) {
      catsEl.innerHTML = '<p class="rest-sub">No recipes. Add one to get started.</p>';
    }
  }

  function recipeCard(r, cat) {
    var div = document.createElement('div');
    div.className = 'rmgr-card' + (r.deleted ? ' is-hidden' : '');
    var tags = '';
    if (r.deleted) tags += ' <span class="mgr-hidden-tag">hidden</span>';
    if (r.isNew) tags += ' <span class="mgr-new-tag">added</span>';

    var saved = document.createElement('span');
    saved.className = 'mgr-saved';

    // Header row: title + tags
    var head = document.createElement('div');
    head.innerHTML = '<label>Title</label>';
    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = r.title;
    head.appendChild(titleInput);
    var tagSpan = document.createElement('span');
    tagSpan.innerHTML = tags;
    head.appendChild(tagSpan);
    div.appendChild(head);

    // Prep / cook
    var grid = document.createElement('div');
    grid.className = 'rmgr-grid';
    var prepWrap = document.createElement('div');
    prepWrap.innerHTML = '<label>Prep</label>';
    var prepInput = document.createElement('input');
    prepInput.type = 'text'; prepInput.value = r.prep; prepInput.placeholder = 'e.g. 15 mins';
    prepWrap.appendChild(prepInput);
    var cookWrap = document.createElement('div');
    cookWrap.innerHTML = '<label>Cook</label>';
    var cookInput = document.createElement('input');
    cookInput.type = 'text'; cookInput.value = r.cook; cookInput.placeholder = 'e.g. 30 mins';
    cookWrap.appendChild(cookInput);
    grid.appendChild(prepWrap); grid.appendChild(cookWrap);

    // Ingredients
    var ingWrap = document.createElement('div');
    ingWrap.className = 'full';
    ingWrap.innerHTML = '<label>Ingredients (one per line)</label>';
    var ingArea = document.createElement('textarea');
    ingArea.value = r.ingredients.join('\n');
    ingWrap.appendChild(ingArea);
    // Instructions
    var insWrap = document.createElement('div');
    insWrap.className = 'full';
    insWrap.innerHTML = '<label>Instructions (one per line)</label>';
    var insArea = document.createElement('textarea');
    insArea.value = r.instructions.join('\n');
    insWrap.appendChild(insArea);
    grid.appendChild(ingWrap); grid.appendChild(insWrap);

    // Category
    var catWrap = document.createElement('div');
    catWrap.className = 'full';
    catWrap.innerHTML = '<label>Category</label>';
    var catSel = document.createElement('select');
    allCatIds().forEach(function (id) {
      var o = document.createElement('option');
      o.value = id; o.textContent = catTitle(id);
      if (id === r.category) o.selected = true;
      catSel.appendChild(o);
    });
    var newOpt = document.createElement('option');
    newOpt.value = '__new'; newOpt.textContent = '+ New category…';
    catSel.appendChild(newOpt);
    var newInput = document.createElement('input');
    newInput.type = 'text'; newInput.placeholder = 'New category name'; newInput.maxLength = 40;
    newInput.style.display = 'none'; newInput.style.marginTop = '0.4rem';
    var newCommitted = false;
    function commitNewCat() {
      if (newCommitted) return;
      var name = newInput.value.trim().slice(0, 40);
      if (!name) { catSel.value = r.category; newInput.style.display = 'none'; newCommitted = true; return; }
      newCommitted = true;
      var id = slugify(name);
      if (customCats.indexOf(id) < 0) customCats.push(id);
      moveRecipe(r, id, saved);
    }
    newInput.addEventListener('blur', commitNewCat);
    newInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitNewCat(); }
      if (e.key === 'Escape') { newCommitted = true; catSel.value = r.category; newInput.style.display = 'none'; }
    });
    catSel.addEventListener('change', function () {
      if (catSel.value === '__new') {
        newCommitted = false; newInput.style.display = ''; newInput.focus();
        return;
      }
      moveRecipe(r, catSel.value, saved);
    });
    catWrap.appendChild(catSel); catWrap.appendChild(newInput);
    grid.appendChild(catWrap);
    div.appendChild(grid);

    // Actions: up/down, hide/delete
    var actions = document.createElement('div');
    actions.className = 'rmgr-actions';
    var upBtn = document.createElement('button');
    upBtn.className = 'mgr-btn'; upBtn.textContent = '↑';
    upBtn.title = 'Move up';
    upBtn.addEventListener('click', function () { reorder(r, -1, saved); });
    var downBtn = document.createElement('button');
    downBtn.className = 'mgr-btn'; downBtn.textContent = '↓';
    downBtn.title = 'Move down';
    downBtn.addEventListener('click', function () { reorder(r, 1, saved); });
    var hideBtn = document.createElement('button');
    hideBtn.className = 'mgr-btn' + (r.isNew ? ' danger' : '');
    hideBtn.textContent = r.deleted ? 'Unhide' : (r.isNew ? 'Delete' : 'Hide');
    hideBtn.addEventListener('click', function () {
      if (r.isNew && !r.deleted) {
        if (!confirm('Delete "' + r.title + '" permanently?')) return;
      }
      var del = r.deleted ? 0 : 1;
      saveEdit(r.id, { deleted: del }, saved).then(function (ok) {
        if (ok) {
          if (r.isNew && del) {
            // Remove from local state entirely
            var c = getCat(r.category);
            c.recipes = c.recipes.filter(function (x) { return x.id !== r.id; });
            delete edits[r.id];
          } else {
            r.deleted = !!del;
          }
          render();
        }
      });
    });
    actions.appendChild(upBtn); actions.appendChild(downBtn); actions.appendChild(hideBtn);
    actions.appendChild(saved);
    div.appendChild(actions);

    // Auto-save on field edits (debounced)
    function bindSave(el, field, isList) {
      var deb = null;
      el.addEventListener('input', function () {
        clearTimeout(deb);
        deb = setTimeout(function () {
          var v = isList ? el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : el.value.trim();
          var upd = {};
          upd[field] = isList ? v : v;
          saveEdit(r.id, upd, saved).then(function (ok) {
            if (ok) {
              if (field === 'title') r.title = v;
              else if (field === 'prep') r.prep = v;
              else if (field === 'cook') r.cook = v;
              else if (field === 'ingredients') r.ingredients = v;
              else if (field === 'instructions') r.instructions = v;
            }
          });
        }, 800);
      });
    }
    bindSave(titleInput, 'title');
    bindSave(prepInput, 'prep');
    bindSave(cookInput, 'cook');
    bindSave(ingArea, 'ingredients', true);
    bindSave(insArea, 'instructions', true);

    return div;
  }

  function moveRecipe(r, newCatId, saved) {
    var oldCat = getCat(r.category);
    saveEdit(r.id, { category: newCatId }, saved).then(function (ok) {
      if (ok) {
        oldCat.recipes = oldCat.recipes.filter(function (x) { return x.id !== r.id; });
        r.category = newCatId;
        getCat(newCatId).recipes.push(r);
        render();
      }
    });
  }

  function reorder(r, dir, saved) {
    var cat = getCat(r.category);
    var list = cat.recipes.filter(function (x) { return !x.deleted; });
    var i = list.indexOf(r);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    // Swap positions: assign explicit positions to the whole list
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    var jobs = list.map(function (x, idx) { return saveEdit(x.id, { position: idx }, null); });
    saved.textContent = 'saving…';
    Promise.all(jobs).then(function (res) {
      var ok = res.every(Boolean);
      saved.textContent = ok ? 'saved' : 'save failed';
      if (ok) {
        list.forEach(function (x, idx) { x.position = idx; });
        cat.recipes.sort(function (a, b) {
          return (a.position === null || a.position === undefined ? 1e9 : a.position) -
                 (b.position === null || b.position === undefined ? 1e9 : b.position);
        });
        render();
      }
      setTimeout(function () { saved.textContent = ''; }, 1500);
    });
  }

  function addRecipe() {
    var tok = token();
    if (!tok) { setMsg('Enter your admin token first.'); tokEl.focus(); return; }
    var rid = 'r-' + Date.now().toString(36);
    var catId = categories.length ? categories[0].id : 'uncategorized';
    saveEdit(rid, {
      title: 'New recipe', prep: '', cook: '',
      ingredients: [], instructions: [],
      category: catId, position: 0, is_new: 1
    }, null).then(function (ok) {
      if (!ok) { setMsg('Could not create recipe.'); return; }
      edits[rid] = { recipe_id: rid, is_new: 1, category: catId };
      var r = {
        id: rid, title: 'New recipe', prep: '', cook: '',
        ingredients: [], instructions: [],
        category: catId, isNew: true, deleted: false, position: 0
      };
      var cat = getCat(catId);
      cat.recipes.unshift(r);
      // Bump positions of others
      cat.recipes.forEach(function (x, idx) { if (x.id !== rid) x.position = idx + 1; });
      setMsg('Recipe added — edit it below.');
      render();
    });
  }

  loadBtn.addEventListener('click', load);
  addBtn.addEventListener('click', addRecipe);
  showHiddenEl.addEventListener('change', render);
  tokEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });

  // Auto-load when the portal pre-filled the token
  if (token()) load();
})();
