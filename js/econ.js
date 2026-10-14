/* Economic Data — U.S. releases calendar. Times are ET (as reported). */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';

  var daysEl = document.getElementById('econ-days');
  var msgEl = document.getElementById('econ-msg');
  var rangeEl = document.getElementById('econ-range');
  var nextEl = document.getElementById('econ-next');

  var weekOffset = 0;
  var impactFilter = 'all';
  var events = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function weekRange(offset) {
    var now = new Date();
    var monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
    var sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: iso(monday), to: iso(sunday) };
  }
  function fmtDay(ds) {
    var d = new Date(ds + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function fmtTime(t) {
    if (!t) return '—';
    var m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return esc(t);
    var h = parseInt(m[1], 10), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + m[2] + ' ' + ap;
  }
  function fmtVal(v) {
    if (v === null || v === undefined || v === '') return '—';
    return esc(String(v));
  }

  function load() {
    var r = weekRange(weekOffset);
    daysEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    msgEl.textContent = '';
    nextEl.hidden = true;
    rangeEl.textContent = '';
    fetch(WORKER_URL + '/econ/calendar?from=' + r.from + '&to=' + r.to + '&country=US')
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          daysEl.innerHTML = '';
          msgEl.textContent = (res.j && res.j.error) || 'Could not load the calendar.';
          return;
        }
        events = (res.j && res.j.events) || [];
        rangeEl.textContent = fmtDay(r.from) + ' – ' + fmtDay(r.to) + ' · ' + events.length + ' U.S. events';
        renderNextUp();
        render();
      })
      .catch(function () {
        daysEl.innerHTML = '';
        msgEl.textContent = 'Could not load the calendar — check your connection.';
      });
  }

  function renderNextUp() {
    var now = new Date();
    var upcoming = events.filter(function (e) {
      if (!e.date) return false;
      var dt = new Date(e.date + 'T' + (e.time || '00:00:00'));
      return dt > now && (e.impact === 'high' || e.impact === 'medium');
    });
    if (!upcoming.length) { nextEl.hidden = true; return; }
    var e = upcoming[0];
    var dt = new Date(e.date + 'T' + (e.time || '00:00:00'));
    var ms = dt - now;
    var parts = [];
    var d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000),
        m = Math.floor(ms % 3600000 / 60000);
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    parts.push(m + 'm');
    nextEl.innerHTML = '<div><div class="lbl">Next market-moving release</div>' +
      '<div class="ev">' + esc(e.event) + '<span class="impact ' + esc(e.impact) + '">' + esc(e.impact) + '</span></div>' +
      '<div class="when">' + fmtDay(e.date) + ' · ' + fmtTime(e.time) + ' ET</div></div>' +
      '<div class="count">in ' + parts.join(' ') + '</div>';
    nextEl.hidden = false;
  }

  function render() {
    daysEl.innerHTML = '';
    var list = impactFilter === 'all' ? events : events.filter(function (e) { return e.impact === impactFilter; });
    if (!list.length) {
      msgEl.textContent = 'No events match this filter for the week.';
      return;
    }
    var byDay = {}, order = [];
    list.forEach(function (e) {
      var k = e.date || 'unknown';
      if (!byDay[k]) { byDay[k] = []; order.push(k); }
      byDay[k].push(e);
    });
    var todayIso = iso(new Date());
    order.sort();
    order.forEach(function (day) {
      var sec = document.createElement('div');
      sec.className = 'econ-day';
      var h = document.createElement('h3');
      h.innerHTML = esc(fmtDay(day)) +
        (day === todayIso ? ' <span class="today">Today</span>' : '') +
        ' <span class="cnt">' + byDay[day].length + ' events</span>';
      sec.appendChild(h);
      byDay[day].forEach(function (e) {
        sec.appendChild(eventRow(e));
      });
      daysEl.appendChild(sec);
    });
  }

  function eventRow(e) {
    var d = document.createElement('div');
    d.className = 'econ-ev';
    d.innerHTML =
      '<div class="t">' + fmtTime(e.time) + ' <span class="etz">ET</span></div>' +
      '<div class="name">' + esc(e.event) +
        (e.impact ? '<span class="impact ' + esc(e.impact) + '">' + esc(e.impact) + '</span>' : '') +
        (e.projected ? ' <span class="proj">expected</span>' : '') +
        (e.period ? ' <span class="etz">' + esc(e.period) + '</span>' : '') + '</div>' +
      '<div class="vals">' +
        '<div class="v"><span class="k">Actual</span><span class="a">' + fmtVal(e.actual) + '</span></div>' +
        '<div class="v"><span class="k">Previous</span><span>' + fmtVal(e.previous) + '</span></div>' +
      '</div>';
    return d;
  }

  document.getElementById('econ-prev').addEventListener('click', function () { weekOffset--; load(); });
  document.getElementById('econ-next-wk').addEventListener('click', function () { weekOffset++; load(); });
  document.getElementById('econ-this').addEventListener('click', function () { weekOffset = 0; load(); });
  Array.prototype.forEach.call(document.querySelectorAll('.econ-filter'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.econ-filter'), function (x) {
        x.classList.remove('active');
      });
      b.classList.add('active');
      impactFilter = b.getAttribute('data-impact');
      render();
    });
  });

  load();
})();
