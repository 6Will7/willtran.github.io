/* Recipes — renders from /data/recipes.json + manager overrides from the worker. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var DATA_URL = '/data/recipes.json';

  var tocEl = document.getElementById('recipe-toc-nav');
  var sectionsEl = document.getElementById('recipe-sections');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Apply manager overrides: field edits, category moves, deletes,
  // reorders, and brand-new recipes (pure overrides).
  function applyEdits(data, edits) {
    var byId = {};
    data.categories.forEach(function (c) {
      (c.recipes || []).forEach(function (r) { byId[r.id] = { recipe: r, cat: c }; });
    });
    // New recipes first (so they exist for subsequent field edits)
    edits.forEach(function (e) {
      if (!e || !e.recipe_id || e.deleted) return;
      if (!byId[e.recipe_id] && e.is_new) {
        var r = {
          id: e.recipe_id,
          title: e.title || 'Untitled',
          prep: e.prep || '',
          cook: e.cook || '',
          ingredients: parseList(e.ingredients),
          instructions: parseList(e.instructions)
        };
        var cat = findOrCreateCat(data, e.category);
        r._position = (e.position === null || e.position === undefined) ? 1e9 : e.position;
        cat.recipes.push(r);
        byId[e.recipe_id] = { recipe: r, cat: cat };
      }
    });
    edits.forEach(function (e) {
      if (!e || !e.recipe_id) return;
      var entry = byId[e.recipe_id];
      if (!entry) return;
      var r = entry.recipe;
      if (e.deleted) { r._deleted = true; return; }
      if (e.title) r.title = e.title;
      if (e.prep !== null && e.prep !== undefined) r.prep = e.prep;
      if (e.cook !== null && e.cook !== undefined) r.cook = e.cook;
      if (e.ingredients) r.ingredients = parseList(e.ingredients);
      if (e.instructions) r.instructions = parseList(e.instructions);
      if (e.category && e.category !== entry.cat.id) {
        // Move to another category
        var oldCat = entry.cat;
        oldCat.recipes = oldCat.recipes.filter(function (x) { return x.id !== r.id; });
        var newCat = findOrCreateCat(data, e.category);
        newCat.recipes.push(r);
        entry.cat = newCat;
      }
      if (e.position !== null && e.position !== undefined) r._position = e.position;
    });
    // Drop deleted, sort by position
    data.categories.forEach(function (c) {
      c.recipes = (c.recipes || [])
        .filter(function (r) { return !r._deleted; })
        .sort(function (a, b) {
          var pa = (a._position === undefined ? 1e9 : a._position);
          var pb = (b._position === undefined ? 1e9 : b._position);
          return pa - pb;
        });
    });
    return data;
  }

  function parseList(v) {
    if (Array.isArray(v)) return v;
    if (!v) return [];
    try {
      var p = JSON.parse(v);
      if (Array.isArray(p)) return p;
    } catch (e) {}
    return String(v).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function findOrCreateCat(data, catId) {
    if (!catId) catId = 'uncategorized';
    var found = null;
    data.categories.forEach(function (c) { if (c.id === catId) found = c; });
    if (!found) {
      found = { id: catId, title: titleCase(catId), icon: '🍽️', recipes: [] };
      data.categories.push(found);
    }
    return found;
  }

  function titleCase(s) {
    return String(s).split(/[-_]+/).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function cardHTML(r) {
    var id = r.id;
    var h = '<div class="recipe-card" id="' + esc(id) + '">' +
      '<h3>' + esc(r.title) + '</h3>' +
      '<div class="recipe-meta">';
    if (r.prep) h += '<span><strong>Prep:</strong> ' + esc(r.prep) + '</span>';
    if (r.cook) h += '<span><strong>Cook:</strong> ' + esc(r.cook) + '</span>';
    h += '</div>';
    if (r.ingredients && r.ingredients.length) {
      h += '<p><strong>Ingredients:</strong></p><ul>' +
        r.ingredients.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') +
        '</ul>';
    }
    if (r.instructions && r.instructions.length) {
      h += '<details class="recipe-accordion"><summary>View instructions</summary>' +
        '<div class="recipe-details-content"><p><strong>Instructions:</strong></p><ol>' +
        r.instructions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
        '</ol></div></details>';
    }
    h += '</div>';
    return h;
  }

  function render(data) {
    tocEl.innerHTML = '';
    sectionsEl.innerHTML = '';
    data.categories.forEach(function (c) {
      // TOC entry
      var navItem = document.createElement('div');
      navItem.className = 'nav-item';
      navItem.setAttribute('data-section', c.id);
      var link = document.createElement('a');
      link.href = '#' + c.id;
      link.textContent = c.title;
      var dropdown = document.createElement('div');
      dropdown.className = 'dropdown-content';
      navItem.appendChild(link);
      navItem.appendChild(dropdown);
      tocEl.appendChild(navItem);

      // Section
      var sec = document.createElement('div');
      sec.id = c.id;
      sec.className = 'section';
      var head = '<div class="recipe-section-head">' +
        '<span class="recipe-section-icon">' + esc(c.icon || '🍽️') + '</span>' +
        '<h2>' + esc(c.title) + '</h2></div>';
      var body;
      if (c.recipes.length) {
        body = '<div class="recipes-grid">' +
          c.recipes.map(cardHTML).join('') + '</div>';
      } else {
        body = '<p class="empty-section">No recipes yet. Check back soon! 👀</p>';
      }
      sec.innerHTML = head + body +
        '<div class="back-link"><a href="#top">↑ Back to categories</a></div>';
      sectionsEl.appendChild(sec);

      // TOC dropdown links + share buttons
      if (!c.recipes.length) {
        dropdown.innerHTML = '<div class="dropdown-empty">Coming soon...</div>';
      } else {
        c.recipes.forEach(function (r) {
          var a = document.createElement('a');
          a.href = '#' + r.id;
          a.textContent = r.title;
          dropdown.appendChild(a);
          if (window.WTShare) {
            var card = sec.querySelector('#' + CSS.escape(r.id));
            if (card) {
              card.appendChild(window.WTShare.row(
                'https://willtran.org/recipes.html#' + r.id,
                r.title + ' — recipe by Will Tran'
              ));
            }
          }
        });
      }
    });
  }

  function showError(msg) {
    sectionsEl.innerHTML = '<p class="empty-section">' + esc(msg) + '</p>';
  }

  Promise.all([
    fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('recipes.json missing'); return r.json(); }),
    fetch(WORKER_URL + '/recipes/edits').then(function (r) { return r.ok ? r.json() : { edits: [] }; }).catch(function () { return { edits: [] }; })
  ]).then(function (res) {
    render(applyEdits(res[0], (res[1] && res[1].edits) || []));
  }).catch(function () {
    showError('Could not load recipes — check your connection.');
  });
})();
