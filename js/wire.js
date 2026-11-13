/* The Wire — merged news, SEC filings and earnings stream for followed tickers.
   Ticker source, in order: this page's custom list (localStorage), the synced
   /stocks watchlist (wt_sync_token), or a starter set of market majors. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var DEFAULTS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'SPY'];

  var sourceEl = document.getElementById('wire-source');
  var streamEl = document.getElementById('wire-stream');
  var updatedEl = document.getElementById('wire-updated');
  var tickerSel = document.getElementById('wire-ticker');
  var editorEl = document.getElementById('wire-editor');
  var symbolsInput = document.getElementById('wire-symbols');

  var symbols = [];
  var items = [];
  var kindFilter = 'ALL';
  var tickerFilter = 'ALL';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cleanSymbols(list) {
    var out = [];
    (list || []).forEach(function (s) {
      s = String(s || '').toUpperCase().replace(/[^A-Z0-9.\-=]/g, '');
      if (s && out.indexOf(s) === -1) out.push(s);
    });
    return out.slice(0, 10);
  }
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
    return '$' + Number(v).toFixed(0);
  }
  function dayKey(ts) {
    var d = new Date(ts * 1000);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }
  function dayLabel(ts) {
    var now = new Date();
    var today = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
    var y = new Date(now.getTime() - 86400000);
    var yKey = y.getFullYear() + '-' + y.getMonth() + '-' + y.getDate();
    if (dayKey(ts) === today) return 'Today';
    if (dayKey(ts) === yKey) return 'Yesterday';
    return new Date(ts * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtTime(ts) {
    return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
  }
  function hourLabel(h) {
    if (h === 'bmo') return 'before market open';
    if (h === 'amc') return 'after market close';
    if (h === 'dmh') return 'during market hours';
    return '';
  }
  function formClass(form) {
    if (String(form).indexOf('10-K') === 0) return 'f-10k';
    if (String(form).indexOf('8-K') === 0) return 'f-8k';
    return '';
  }

  function itemHTML(it) {
    var side = '<div class="side">' +
      '<a class="wire-tick" href="/stocks/?symbol=' + encodeURIComponent(it.symbol) + '">' + esc(it.symbol) + '</a>' +
      '<span class="wire-kind k-' + it.kind + '">' + it.kind + '</span></div>';
    var main;
    if (it.kind === 'news') {
      main = '<div class="title">' + (it.url
        ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a>'
        : esc(it.title)) + '</div>' +
        '<div class="meta">' + esc(it.source || 'News') + ' · ' + dayLabel(it.ts) + ', ' + fmtTime(it.ts) + '</div>' +
        (it.summary ? '<div class="summary">' + esc(it.summary) + '</div>' : '');
    } else if (it.kind === 'filing') {
      main = '<div class="title"><span class="wire-form ' + formClass(it.form) + '">' + esc(it.form) + '</span> ' +
        (it.topics && it.topics.length ? esc(it.topics.join(' · ')) : 'filing') + '</div>' +
        '<div class="meta">Filed ' + fmtDate(it.filingDate) +
        (it.reportDate ? ' · Period ended ' + fmtDate(it.reportDate) : '') + '</div>' +
        '<div class="links">' +
        '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">Document</a>' +
        '<a href="' + esc(it.indexUrl) + '" target="_blank" rel="noopener">Index</a></div>';
    } else {
      var when = fmtDate(it.date) + (hourLabel(it.hour) ? ' · ' + hourLabel(it.hour) : '');
      var nums = '';
      if (it.epsActual != null) {
        nums = 'EPS ' + Number(it.epsActual).toFixed(2) +
          (it.epsEstimate != null ? ' vs est ' + Number(it.epsEstimate).toFixed(2) : '') +
          (it.revenueActual != null ? ' · Revenue ' + fmtMoney(it.revenueActual) +
            (it.revenueEstimate != null ? ' vs est ' + fmtMoney(it.revenueEstimate) : '') : '');
      } else if (it.epsEstimate != null || it.revenueEstimate != null) {
        nums = (it.epsEstimate != null ? 'EPS est ' + Number(it.epsEstimate).toFixed(2) : '') +
          (it.revenueEstimate != null ? (nums ? ' · ' : '') + 'Revenue est ' + fmtMoney(it.revenueEstimate) : '');
      }
      var q = it.quarter ? 'Q' + it.quarter + (it.year ? ' ' + it.year : '') + ' ' : '';
      main = '<div class="title">' + q + 'earnings</div>' +
        '<div class="meta">' + when + (nums ? ' · ' + nums : '') + '</div>';
    }
    return '<div class="wire-item">' + side + '<div class="main">' + main + '</div></div>';
  }

  function render() {
    var rows = items.filter(function (it) {
      return (kindFilter === 'ALL' || it.kind === kindFilter) &&
             (tickerFilter === 'ALL' || it.symbol === tickerFilter);
    });
    if (!rows.length) {
      streamEl.innerHTML = '<p class="wire-empty">Nothing in the stream for this filter.</p>';
      return;
    }
    var html = '', lastDay = '';
    rows.forEach(function (it) {
      var k = dayKey(it.ts);
      if (k !== lastDay) { html += '<div class="wire-day">' + dayLabel(it.ts) + '</div>'; lastDay = k; }
      html += itemHTML(it);
    });
    streamEl.innerHTML = html;
  }

  function loadFeed() {
    streamEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    updatedEl.textContent = '';
    fetch(WORKER_URL + '/wire/feed?symbols=' + encodeURIComponent(symbols.join(',')))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        items = (j && j.items) || [];
        if (!items.length) {
          streamEl.innerHTML = '<p class="wire-empty">The stream came back empty — try Refresh in a bit.</p>';
          return;
        }
        updatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
          ' · ' + items.length + ' items · news from the last 10 days, earnings ±2 weeks.';
        render();
      })
      .catch(function () {
        streamEl.innerHTML = '<p class="wire-empty">Could not load the wire — try Refresh.</p>';
      });
  }

  function setSource(list, label) {
    symbols = list;
    sourceEl.innerHTML = 'Following <strong>' + esc(list.join(', ')) + '</strong> — ' + esc(label);
    tickerSel.innerHTML = '<option value="ALL">All tickers</option>' + list.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    }).join('');
    tickerFilter = 'ALL';
    loadFeed();
  }

  function resolveSymbols() {
    var custom = null;
    try { custom = JSON.parse(localStorage.getItem('wire_symbols') || 'null'); } catch (e) {}
    if (Array.isArray(custom) && cleanSymbols(custom).length) {
      setSource(cleanSymbols(custom), 'custom list saved in this browser.');
      return;
    }
    var tok = null;
    try { tok = localStorage.getItem('wt_sync_token'); } catch (e) {}
    if (!tok) {
      setSource(DEFAULTS, 'starter set. Set a watchlist on /stocks or customize to make it yours.');
      return;
    }
    sourceEl.textContent = 'Loading your watchlist…';
    fetch(WORKER_URL + '/sync/watchlist', { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = cleanSymbols((j && j.tickers) || []);
        if (list.length) setSource(list, 'your synced /stocks watchlist.');
        else setSource(DEFAULTS, 'your watchlist is empty, so here is a starter set.');
      })
      .catch(function () {
        setSource(DEFAULTS, 'starter set (watchlist unreachable).');
      });
  }

  document.querySelectorAll('.wire-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.wire-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      kindFilter = chip.getAttribute('data-kind');
      render();
    });
  });
  tickerSel.addEventListener('change', function () { tickerFilter = tickerSel.value; render(); });
  document.getElementById('wire-refresh').addEventListener('click', loadFeed);
  document.getElementById('wire-customize').addEventListener('click', function () {
    editorEl.hidden = !editorEl.hidden;
    if (!editorEl.hidden) symbolsInput.value = symbols.join(', ');
  });
  document.getElementById('wire-save').addEventListener('click', function () {
    var list = cleanSymbols(symbolsInput.value.split(','));
    try {
      if (list.length) localStorage.setItem('wire_symbols', JSON.stringify(list));
      else localStorage.removeItem('wire_symbols');
    } catch (e) {}
    editorEl.hidden = true;
    resolveSymbols();
  });
  document.getElementById('wire-reset').addEventListener('click', function () {
    try { localStorage.removeItem('wire_symbols'); } catch (e) {}
    symbolsInput.value = '';
    editorEl.hidden = true;
    resolveSymbols();
  });

  resolveSymbols();
})();
