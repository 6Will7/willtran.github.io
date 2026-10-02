/* NASA Astronomy Picture of the Day hero on the homepage.
   Fetches the day's photo through the Cloudflare worker (cached per-day).
   The section stays hidden if the API is unavailable. */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';

  function truncate(s, n) {
    if (s.length <= n) return s;
    return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
  }

  fetch(WORKER_URL + '/apod')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.url) return;
      var img = document.getElementById('apod-img');
      img.src = d.url;
      img.alt = d.title ? 'NASA Astronomy Picture of the Day: ' + d.title : 'NASA Astronomy Picture of the Day';
      var title = document.getElementById('apod-title');
      var date = document.getElementById('apod-date');
      var desc = document.getElementById('apod-desc');
      if (title && d.title) title.textContent = d.title;
      if (date && d.date) date.textContent = d.date;
      if (desc && d.explanation) desc.textContent = truncate(d.explanation, 220);
      document.getElementById('apod').hidden = false;
    })
    .catch(function () { /* section stays hidden */ });
})();
