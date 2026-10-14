/* Shared share buttons (X / Facebook / copy link) for willtran.org.
 * Usage: WTShare.row(url, text) returns a .share-row element.
 */
(function () {
  'use strict';

  function openShare(kind, url, text) {
    if (kind === 'x') {
      window.open(
        'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) +
        '&text=' + encodeURIComponent(text || ''),
        '_blank', 'noopener,width=560,height=460'
      );
    } else if (kind === 'facebook') {
      window.open(
        'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
        '_blank', 'noopener,width=560,height=460'
      );
    }
  }

  function copyLink(url, btn) {
    var done = function (ok) {
      var orig = btn.getAttribute('data-label') || btn.textContent;
      btn.textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(function () { btn.textContent = orig; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { done(document.execCommand('copy')); } catch (e) { done(false); }
      document.body.removeChild(ta);
    }
  }

  function row(url, text) {
    var div = document.createElement('div');
    div.className = 'share-row';
    var label = document.createElement('span');
    label.className = 'share-label';
    label.textContent = 'Share:';
    div.appendChild(label);
    [
      { kind: 'x', label: 'X', aria: 'Share on X' },
      { kind: 'facebook', label: 'f', aria: 'Share on Facebook' }
    ].forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'share-btn';
      b.textContent = s.label;
      b.setAttribute('aria-label', s.aria);
      b.addEventListener('click', function () { openShare(s.kind, url, text); });
      div.appendChild(b);
    });
    var c = document.createElement('button');
    c.type = 'button';
    c.className = 'share-btn';
    c.textContent = 'Copy link';
    c.setAttribute('data-label', 'Copy link');
    c.setAttribute('aria-label', 'Copy link to share');
    c.addEventListener('click', function () { copyLink(url, c); });
    div.appendChild(c);
    return div;
  }

  window.WTShare = { row: row, openShare: openShare, copyLink: copyLink };
})();
