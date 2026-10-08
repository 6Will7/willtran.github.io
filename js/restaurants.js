/* Restaurants page: approved list, cuisine filters, map embed, submission form. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var listEl = document.getElementById('rest-list');
  var filtersEl = document.getElementById('rest-filters');
  var mapEl = document.getElementById('rest-map');
  var form = document.getElementById('rest-form');
  var formMsg = document.getElementById('rest-form-msg');
  var all = [];
  var activeCuisine = 'All';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mapsQuery(r) {
    return 'https://www.google.com/maps?q=' +
      encodeURIComponent(r.name + ' ' + r.neighborhood + ' Bay Area') + '&output=embed';
  }

  function mapsLink(r) {
    if (r.maps_url) return r.maps_url;
    return 'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(r.name + ' ' + r.neighborhood);
  }

  function render() {
    var items = activeCuisine === 'All' ? all : all.filter(function (r) { return r.cuisine === activeCuisine; });
    if (!items.length) {
      listEl.innerHTML = '<div class="rest-empty">' +
        (all.length ? 'Nothing in this cuisine yet.' : 'No restaurants yet — suggest one below!') + '</div>';
      return;
    }
    listEl.innerHTML = items.map(function (r, i) {
      return '<article class="rest-card" data-idx="' + i + '" tabindex="0" role="button" ' +
        'aria-label="Show ' + esc(r.name) + ' on the map">' +
        '<h3>' + esc(r.name) + '</h3>' +
        '<p class="rest-meta">' + esc(r.cuisine) + ' · ' + esc(r.neighborhood) +
        ' · <span class="rest-price">' + '$'.repeat(Math.min(4, Math.max(1, r.price || 2))) + '</span></p>' +
        (r.notes ? '<p class="rest-notes">' + esc(r.notes) + '</p>' : '') +
        '<div class="rest-foot"><a class="rest-maps-link" href="' + esc(mapsLink(r)) + '" target="_blank" rel="noopener">View on Maps →</a>' +
        (r.submitted_by && r.submitted_by !== 'Will' ? '<span class="rest-by">suggested by ' + esc(r.submitted_by) + '</span>' : '') +
        '</div></article>';
    }).join('');
    // keep a reference for map clicks
    listEl._items = items;
  }

  function renderFilters() {
    var cuisines = ['All'];
    all.forEach(function (r) { if (cuisines.indexOf(r.cuisine) === -1) cuisines.push(r.cuisine); });
    filtersEl.innerHTML = cuisines.map(function (c) {
      return '<button type="button" class="rest-chip" data-cuisine="' + esc(c) + '" aria-pressed="' +
        (c === activeCuisine) + '">' + esc(c) + '</button>';
    }).join('');
  }

  listEl.addEventListener('click', function (e) {
    var card = e.target.closest('.rest-card');
    if (!card || e.target.closest('a')) return;
    showOnMap(parseInt(card.getAttribute('data-idx'), 10));
  });
  listEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest('.rest-card');
    if (!card) return;
    e.preventDefault();
    showOnMap(parseInt(card.getAttribute('data-idx'), 10));
  });

  function showOnMap(i) {
    var r = (listEl._items || [])[i];
    if (!r || !mapEl) return;
    mapEl.src = mapsQuery(r);
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  filtersEl.addEventListener('click', function (e) {
    var chip = e.target.closest('.rest-chip');
    if (!chip) return;
    activeCuisine = chip.getAttribute('data-cuisine');
    renderFilters();
    render();
  });

  fetch(WORKER_URL + '/restaurants')
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (d) {
      all = (d && d.restaurants) || [];
      renderFilters();
      render();
    })
    .catch(function () {
      listEl.innerHTML = '<div class="rest-empty">Could not load the list — try again later.</div>';
    });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    formMsg.className = 'rest-form-msg';
    formMsg.textContent = 'Submitting…';
    var data = {};
    ['name', 'cuisine', 'neighborhood', 'price', 'notes', 'maps_url', 'submitted_by'].forEach(function (k) {
      data[k] = form.elements[k].value.trim();
    });
    if (!data.name || !data.cuisine || !data.neighborhood) {
      formMsg.classList.add('err');
      formMsg.textContent = 'Please fill in the name, cuisine, and neighborhood.';
      return;
    }
    fetch(WORKER_URL + '/restaurants/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (r) {
        if (r.ok) {
          formMsg.classList.add('ok');
          formMsg.textContent = 'Thanks! Your suggestion is in the queue — it will appear once approved.';
          form.reset();
        } else {
          formMsg.classList.add('err');
          formMsg.textContent = (r.j && r.j.error) || 'Submission failed — try again later.';
        }
      })
      .catch(function () {
        formMsg.classList.add('err');
        formMsg.textContent = 'Submission failed — check your connection and try again.';
      });
  });
})();
