/* ============================================================
   calculator.js — UI wiring for the natural-language calculator
   Depends on: js/main.js (header/footer/theme), js/calc-engine.js
   History is stored in localStorage on this browser only.
   ============================================================ */
(function () {
  'use strict';

  var HISTORY_KEY = 'wt-calc-history';
  var HISTORY_MAX = 20;

  function $(id) { return document.getElementById(id); }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveHistory(items) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX))); }
    catch (e) { /* storage unavailable — history just won't persist */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.CalcEngine) {
      var v = $('calc-value');
      if (v) { v.textContent = 'Calculator failed to load. Please refresh the page.'; v.classList.add('calc-error'); }
      return;
    }

    var input = $('calc-input');
    var goBtn = $('calc-go');
    var interpEl = $('calc-interpretation');
    var valueEl = $('calc-value');
    var historyEl = $('calc-history');
    var clearBtn = $('calc-clear');

    var lastAns = null;
    var history = loadHistory();

    function renderResult(r, question) {
      if (r.ok) {
        lastAns = r.value;
        interpEl.textContent = r.interpretation ? 'Interpreted as: ' + r.interpretation : '';
        valueEl.textContent = r.display;
        valueEl.classList.remove('calc-error', 'calc-idle');
        pushHistory(question, r.display);
      } else {
        interpEl.textContent = '';
        valueEl.textContent = r.error;
        valueEl.classList.add('calc-error');
        valueEl.classList.remove('calc-idle');
      }
    }

    function pushHistory(question, answer) {
      history.unshift({ q: question, a: answer });
      history = history.slice(0, HISTORY_MAX);
      saveHistory(history);
      renderHistory();
    }

    function renderHistory() {
      historyEl.innerHTML = '';
      if (!history.length) {
        var empty = document.createElement('li');
        empty.className = 'calc-history-empty';
        empty.textContent = 'Nothing yet — your recent calculations will show up here.';
        historyEl.appendChild(empty);
        return;
      }
      history.forEach(function (item) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Calculate again';
        var q = document.createElement('span');
        q.className = 'hist-q';
        q.textContent = item.q;
        var a = document.createElement('span');
        a.className = 'hist-a';
        a.textContent = item.a;
        btn.appendChild(q);
        btn.appendChild(a);
        btn.addEventListener('click', function () {
          input.value = item.q;
          doCalculate(item.q);
          input.focus();
        });
        li.appendChild(btn);
        historyEl.appendChild(li);
      });
    }

    function doCalculate(question) {
      var q = (question === undefined) ? input.value : question;
      if (!q || !q.trim()) {
        interpEl.textContent = '';
        valueEl.textContent = 'Type a question first — e.g. "15% of 240".';
        valueEl.classList.add('calc-error');
        valueEl.classList.remove('calc-idle');
        return;
      }
      renderResult(window.CalcEngine.calculate(q, lastAns), q.trim());
    }

    goBtn.addEventListener('click', function () { doCalculate(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doCalculate();
    });

    document.querySelectorAll('.calc-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var q = chip.getAttribute('data-q');
        input.value = q;
        doCalculate(q);
        input.focus();
      });
    });

    clearBtn.addEventListener('click', function () {
      history = [];
      saveHistory(history);
      renderHistory();
    });

    renderHistory();
  });
})();
