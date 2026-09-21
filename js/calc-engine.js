/* ============================================================
   calc-engine.js — natural-language calculator engine
   Pure client-side math parser. No eval(), no dependencies.

   Understands:
     - arithmetic: "2 + 2", "7 times 8", "10 divided by 4"
     - percentages: "15% of 240", "20% off 80", "200 + 15%"
     - powers & roots: "2 to the power of 10", "square root of 144",
       "10 squared", "5!"
     - functions: sin/cos/tan (degrees), asin/acos/atan, log, ln,
       abs, floor, ceil, round, exp; constants pi, e, tau
     - unit conversion: "5 miles to km", "100 fahrenheit to celsius",
       "2 gallons to liters", "1 week to hours"
     - linear equations: "solve 2x + 5 = 15"

   API: CalcEngine.calculate(input, lastAnswer)
        -> { ok:true, kind, value, display, interpretation }
        -> { ok:false, error }
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- errors ---------------- */
  function CalcError(message) { this.message = message; this.name = 'CalcError'; }
  CalcError.prototype = Object.create(Error.prototype);
  CalcError.prototype.constructor = CalcError;
  function fail(msg) { throw new CalcError(msg); }

  /* ---------------- preprocessing ---------------- */
  var LEADERS = /^\s*(what is|what's|whats|calculate|compute|evaluates?|how much is|how much|please)\s+/;

  var WORDS = [
    [/\bto the power of\b/g, '^'],
    [/\braised to the power of\b/g, '^'],
    [/\braised to\b/g, '^'],
    [/\bdivided by\b/g, '/'],
    [/\bdivide by\b/g, '/'],
    [/\bmultiplied by\b/g, '*'],
    [/\bmultiply by\b/g, '*'],
    [/\btimes\b/g, '*'],
    [/\bplus\b/g, '+'],
    [/\bminus\b/g, '-'],
    [/\bover\b/g, '/'],
    [/\bmodulo\b/g, '%'],
    [/\bmod\b/g, '%'],
    [/\bsquared\b/g, '^2'],
    [/\bcubed\b/g, '^3'],
    [/\bsquare root of\b/g, 'sqrt '],
    [/\bsquare root\b/g, 'sqrt '],
    [/\bcube root of\b/g, 'cbrt '],
    [/\bcube root\b/g, 'cbrt '],
    [/\bper\s*cent\b/g, '%'],
    [/\bpercent\b/g, '%'],
    [/\bhalf of\b/g, '(1/2)*'],
    [/\bdouble\b/g, '2*'],
    [/\btriple\b/g, '3*']
  ];

  function preprocess(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase();
    var solveMode = false;

    s = s.replace(/\u00d7/g, '*').replace(/\u00f7/g, '/').replace(/[\u2212\u2013\u2014]/g, '-');
    s = s.replace(/\u221a/g, 'sqrt ').replace(/\u00b0/g, '').replace(/\?/g, ' ');
    s = s.replace(/(\d),(\d)/g, '$1$2');                 // 1,000 -> 1000
    s = s.replace(/[$\u20ac\u00a3\u00a5]/g, ' ');        // currency symbols
    s = s.replace(/\b(dollars?|bucks?|usd)\b/g, ' ');

    // "how many feet in a mile" -> "convert a mile to feet"
    s = s.replace(/^how many\s+(.+?)\s+in\s+(.+)$/, 'convert $2 to $1');

    s = s.replace(LEADERS, '');
    s = s.replace(/^\s*the\s+/, '');

    var m = s.match(/^\s*solve\s+(.+)$/);
    if (m) { solveMode = true; s = m[1]; }

    // "add X to Y" / "subtract X from Y" (before generic word ops)
    s = s.replace(/\badd\s+(.+?)\s+to\s+(.+)$/, '($2)+($1)');
    s = s.replace(/\bsubtract\s+(.+?)\s+from\s+(.+)$/, '($2)-($1)');

    for (var i = 0; i < WORDS.length; i++) s = s.replace(WORDS[i][0], WORDS[i][1]);

    s = s.replace(/\ban?\b/g, '1');                      // articles -> 1

    // magnitude words: "2.5 billion" -> "2.5*1000000000"
    s = s.replace(/(\d+(?:\.\d+)?)\s+hundreds?\b/g, '$1*100');
    s = s.replace(/(\d+(?:\.\d+)?)\s+thousands?\b/g, '$1*1000');
    s = s.replace(/(\d+(?:\.\d+)?)\s+millions?\b/g, '$1*1000000');
    s = s.replace(/(\d+(?:\.\d+)?)\s+billions?\b/g, '$1*1000000000');
    s = s.replace(/(\d+(?:\.\d+)?)\s+trillions?\b/g, '$1*1000000000000');

    s = s.replace(/(\d+(?:\.\d+)?)\s+factorial\b/g, '$1!');

    // percent forms
    s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*of\b/g, '($1/100)*');
    s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*off\b/g, '(1-$1/100)*');
    s = s.replace(/\+\s*(\d+(?:\.\d+)?)\s*%\s*$/, '*(1+$1/100)');
    s = s.replace(/-\s*(\d+(?:\.\d+)?)\s*%\s*$/, '*(1-$1/100)');
    // bare "%" is a percent only when NOT followed by another operand
    // (otherwise it is the modulo operator, e.g. "17 % 5")
    s = s.replace(/(\d+(?:\.\d+)?)\s*%(?=\s*(?:[+\-*/^!)]|$))/g, '($1/100)');

    // "x" as multiplication outside solve mode ("3 x 4", "6x9")
    if (!solveMode) {
      s = s.replace(/(\d)x(\d)/g, '$1*$2');
      s = s.replace(/\bx\b/g, '*');
    }

    s = s.replace(/\s+/g, ' ').trim();
    return { text: s, solveMode: solveMode };
  }

  function pretty(s) {
    return s
      .replace(/\*/g, '\u00d7')
      .replace(/\//g, '\u00f7')
      .replace(/-/g, '\u2212')
      .replace(/sqrt /g, '\u221a')
      .replace(/cbrt /g, '\u221b');
  }

  /* ---------------- tokenizer ---------------- */
  function tokenize(text) {
    var tokens = [], i = 0, n = text.length;
    while (i < n) {
      var ch = text[i];
      if (ch === ' ') { i++; continue; }
      if ((ch >= '0' && ch <= '9') || ch === '.') {
        var j = i, dots = 0;
        while (j < n && ((text[j] >= '0' && text[j] <= '9') || text[j] === '.')) {
          if (text[j] === '.') { dots++; if (dots > 1) fail("I couldn't read that number."); }
          j++;
        }
        var numStr = text.slice(i, j);
        // scientific notation: 1e5, 2e-3 ("e" only when followed by digits)
        if (text[j] === 'e' || text[j] === 'E') {
          var k = j + 1;
          if (text[k] === '+' || text[k] === '-') k++;
          if (k < n && text[k] >= '0' && text[k] <= '9') {
            var q = k;
            while (q < n && text[q] >= '0' && text[q] <= '9') q++;
            numStr = text.slice(i, j) + 'e' + text.slice(j + 1, q);
            j = q;
          }
        }
        if (numStr === '.') fail("I couldn't read that number.");
        tokens.push({ t: 'num', v: parseFloat(numStr) });
        i = j; continue;
      }
      if (ch >= 'a' && ch <= 'z') {
        var k2 = i;
        while (k2 < n && text[k2] >= 'a' && text[k2] <= 'z') k2++;
        tokens.push({ t: 'id', v: text.slice(i, k2) });
        i = k2; continue;
      }
      if ('+-*/^%!(),='.indexOf(ch) >= 0) { tokens.push({ t: 'op', v: ch }); i++; continue; }
      fail("I don't understand '" + ch + "'.");
    }
    return tokens;
  }

  /* ---------------- parser (recursive descent, no eval) ---------------- */
  var CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

  var FUNCTIONS = {
    sqrt: function (x) { if (x < 0) fail('Square root of a negative number.'); return Math.sqrt(x); },
    cbrt: function (x) { return Math.cbrt ? Math.cbrt(x) : (x < 0 ? -1 : 1) * Math.pow(Math.abs(x), 1 / 3); },
    sin: function (d) { return Math.sin(d * Math.PI / 180); },
    cos: function (d) { return Math.cos(d * Math.PI / 180); },
    tan: function (d) {
      var r = Math.tan(d * Math.PI / 180);
      if (!isFinite(r)) fail('Tangent is undefined there.');
      return r;
    },
    asin: function (x) { if (Math.abs(x) > 1) fail('asin needs a value between -1 and 1.'); return Math.asin(x) * 180 / Math.PI; },
    acos: function (x) { if (Math.abs(x) > 1) fail('acos needs a value between -1 and 1.'); return Math.acos(x) * 180 / Math.PI; },
    atan: function (x) { return Math.atan(x) * 180 / Math.PI; },
    log: function (x) { if (x <= 0) fail('log needs a positive number.'); return Math.log10 ? Math.log10(x) : Math.log(x) / Math.LN10; },
    log10: function (x) { if (x <= 0) fail('log10 needs a positive number.'); return Math.log10 ? Math.log10(x) : Math.log(x) / Math.LN10; },
    ln: function (x) { if (x <= 0) fail('ln needs a positive number.'); return Math.log(x); },
    exp: function (x) { return Math.exp(x); },
    abs: function (x) { return Math.abs(x); },
    floor: function (x) { return Math.floor(x); },
    ceil: function (x) { return Math.ceil(x); },
    round: function (x) { return Math.round(x); }
  };

  function factorial(x) {
    if (x < 0 || Math.round(x) !== x) fail('Factorial only works on whole numbers 0 and up.');
    if (x > 170) fail('That factorial is too large to compute.');
    var r = 1;
    for (var i = 2; i <= x; i++) r *= i;
    return r;
  }

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function Parser(tokens, ctx) { this.t = tokens; this.p = 0; this.ctx = ctx || {}; }
  Parser.prototype.peek = function () { return this.t[this.p]; };
  Parser.prototype.next = function () { return this.t[this.p++]; };

  Parser.prototype.parse = function () {
    var v = this.parseAddSub();
    var tk = this.peek();
    if (tk) fail("I didn't understand '" + tk.v + "' in there.");
    return v;
  };

  Parser.prototype.parseAddSub = function () {
    var v = this.parseMulDiv();
    for (;;) {
      var tk = this.peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '+' && tk.v !== '-')) return v;
      this.next();
      var r = this.parseMulDiv();
      v = (tk.v === '+') ? v + r : v - r;
    }
  };

  Parser.prototype.parseMulDiv = function () {
    var v = this.parseImplicit();
    for (;;) {
      var tk = this.peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '*' && tk.v !== '/' && tk.v !== '%')) return v;
      this.next();
      var r = this.parseImplicit();
      if (tk.v === '*') v = v * r;
      else if (tk.v === '/') { if (r === 0) fail('Division by zero.'); v = v / r; }
      else { if (r === 0) fail('Modulo by zero.'); v = v % r; }
    }
  };

  Parser.prototype.parseImplicit = function () {
    var v = this.parseUnary();
    for (;;) {
      var tk = this.peek();
      if (!tk) return v;
      if (!(tk.t === 'num' || tk.v === '(' || tk.t === 'id')) return v;
      v = v * this.parseUnary();
    }
  };

  Parser.prototype.parseUnary = function () {
    var tk = this.peek();
    if (tk && tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      this.next();
      var v = this.parseUnary();
      return tk.v === '-' ? -v : v;
    }
    return this.parsePower();
  };

  Parser.prototype.parsePower = function () {
    var base = this.parsePostfix();
    var tk = this.peek();
    if (tk && tk.t === 'op' && tk.v === '^') {
      this.next();
      var exp = this.parseUnary();           // right-associative, allows 2^-3
      var r = Math.pow(base, exp);
      if (!isFinite(r)) fail('That power is too large.');
      return r;
    }
    return base;
  };

  Parser.prototype.parsePostfix = function () {
    var v = this.parsePrimary();
    for (;;) {
      var tk = this.peek();
      if (!tk || tk.t !== 'op' || tk.v !== '!') return v;
      this.next();
      v = factorial(v);
    }
  };

  Parser.prototype.parsePrimary = function () {
    var tk = this.next();
    if (!tk) fail('I expected a number here.');
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'op' && tk.v === '(') {
      var v = this.parseAddSub();
      var c = this.next();
      if (!c || c.t !== 'op' || c.v !== ')') fail('Missing a closing parenthesis.');
      return v;
    }
    if (tk.t === 'id') {
      var name = tk.v;
      if (hasOwn(CONSTANTS, name)) return CONSTANTS[name];
      if (name === 'ans') {
        if (this.ctx.ans == null) fail('No previous answer yet \u2014 calculate something first.');
        return this.ctx.ans;
      }
      if (name === 'x') {
        if (this.ctx.solve) return this.ctx.x;
        fail("I don't know the word 'x'. To solve for x, try 'solve 2x + 5 = 15'.");
      }
      if (hasOwn(FUNCTIONS, name)) {
        var fn = FUNCTIONS[name], arg, pk = this.peek();
        if (pk && pk.t === 'op' && pk.v === '(') {
          this.next();
          arg = this.parseAddSub();
          var cp = this.next();
          if (!cp || cp.t !== 'op' || cp.v !== ')') fail('Missing a closing parenthesis.');
        } else {
          arg = this.parseUnary();
        }
        return fn(arg);
      }
      fail("I don't know the word '" + name + "'.");
    }
    fail("I didn't expect '" + tk.v + "' here.");
  };

  function evaluate(text, ctx) {
    var tokens = tokenize(text);
    if (!tokens.length) fail('Type something to calculate.');
    return new Parser(tokens, ctx).parse();
  }

  /* ---------------- unit conversion ---------------- */
  var UNIT_CATS = {
    length: { units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
    mass:   { units: { mg: 0.000001, g: 0.001, kg: 1, oz: 0.028349523125, lb: 0.45359237 } },
    volume: { units: { ml: 0.001, l: 1, tsp: 0.00492892159375, tbsp: 0.01478676478125, cup: 0.2365882365, floz: 0.0295735295625, pint: 0.473176473, quart: 0.946352946, gal: 3.785411784 } },
    time:   { units: { ms: 0.001, s: 1, sec: 1, min: 60, hr: 3600, day: 86400, week: 604800 } }
  };
  var UNIT_ALIASES = {
    millimeter: 'mm', millimeters: 'mm', centimeter: 'cm', centimeters: 'cm',
    meter: 'm', meters: 'm', kilometre: 'km', kilometer: 'km', kilometres: 'km', kilometers: 'km',
    inch: 'in', inches: 'in', foot: 'ft', feet: 'ft', yard: 'yd', yards: 'yd', mile: 'mi', miles: 'mi',
    milligram: 'mg', milligrams: 'mg', millisecond: 'ms', milliseconds: 'ms',
    gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg',
    ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb',
    milliliter: 'ml', milliliters: 'ml', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
    teaspoon: 'tsp', teaspoons: 'tsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
    cups: 'cup', fluidounce: 'floz', fluidounces: 'floz', pints: 'pint', quarts: 'quart',
    gallon: 'gal', gallons: 'gal',
    second: 's', seconds: 's', secs: 's', minute: 'min', minutes: 'min', mins: 'min',
    hour: 'hr', hours: 'hr', hrs: 'hr', days: 'day', weeks: 'week',
    celsius: 'c', centigrade: 'c', fahrenheit: 'f', kelvin: 'k'
  };
  var TEMP_UNITS = { c: 1, f: 1, k: 1 };

  function canonUnit(u) {
    u = u.trim().replace(/\s+/g, '');
    if (hasOwn(UNIT_ALIASES, u)) u = UNIT_ALIASES[u];
    return u;
  }
  function unitCat(u) {
    for (var c in UNIT_CATS) {
      if (hasOwn(UNIT_CATS, c) && UNIT_CATS[c].units[u] != null) return c;
    }
    return null;
  }
  function isKnownUnit(u) { return !!TEMP_UNITS[u] || !!unitCat(u); }
  function toCelsius(v, u) { return u === 'c' ? v : u === 'f' ? (v - 32) * 5 / 9 : v - 273.15; }
  function fromCelsius(v, u) { return u === 'c' ? v : u === 'f' ? v * 9 / 5 + 32 : v + 273.15; }

  // Returns a conversion result object, or null when the input isn't a conversion.
  function tryConversion(text) {
    // Pass 1: "... to ..." / "... into ..." (unambiguous separators)
    var m1 = text.match(/^(?:convert\s+)?(.+?)\s+([a-z]+(?: [a-z]+)?)\s+(?:to|into)\s+([a-z]+(?: [a-z]+)?)$/);
    if (m1) {
      var r1 = convertParts(m1[1], m1[2], m1[3]);
      if (r1) return r1;
      // known units but incompatible, or unknown target: convertParts throws;
      // unknown source unit falls through to math below
    }
    // Pass 2: "... in ..." — "in" doubles as the inches abbreviation
    var m2 = text.match(/^(?:convert\s+)?(.+)\sin\s+([a-z]+(?: [a-z]+)?)$/);
    if (m2) {
      var left = m2[1], target = m2[2];
      // (a) separator reading: "<value> <unit> in <target>"
      var lm = left.match(/^(.*?)\s+([a-z]+(?: [a-z]+)?)$/);
      if (lm) {
        var ra = convertParts(lm[1], lm[2], target);
        if (ra) return ra;
      }
      // (b) "in" is the unit: "<value> in <target>" (inches)
      var rb = convertParts(left, 'in', target);
      if (rb) return rb;
    }
    return null;
  }

  // Returns result object, null (not a conversion — let math try), or throws.
  function convertParts(valueText, fromWord, toWord) {
    var fromU = canonUnit(fromWord), toU = canonUnit(toWord);
    var fromKnown = isKnownUnit(fromU), toKnown = isKnownUnit(toU);
    if (!fromKnown && !toKnown) return null;
    if (!fromKnown) fail("I don't know the unit '" + fromWord.trim() + "'.");
    if (!toKnown) fail("I don't know the unit '" + toWord.trim() + "'.");
    var value = evaluate(valueText, {});
    var result;
    if (TEMP_UNITS[fromU] || TEMP_UNITS[toU]) {
      if (!(TEMP_UNITS[fromU] && TEMP_UNITS[toU]))
        fail("Can't convert " + fromWord.trim() + ' to ' + toWord.trim() + '.');
      result = fromCelsius(toCelsius(value, fromU), toU);
    } else {
      var fc = unitCat(fromU), tc = unitCat(toU);
      if (fc !== tc) fail("Can't convert " + fromWord.trim() + ' to ' + toWord.trim() + '.');
      result = value * UNIT_CATS[fc].units[fromU] / UNIT_CATS[tc].units[toU];
    }
    return { value: value, from: fromWord.trim(), to: toWord.trim(), result: result };
  }

  /* ---------------- bond math ---------------- */
  // Light normalization for keyword parsing (does not mangle "5%")
  function lightNormalize(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase();
    s = s.replace(/\u00d7/g, '*').replace(/\u00f7/g, '/').replace(/[\u2212\u2013\u2014]/g, '-');
    s = s.replace(/\?/g, ' ');
    s = s.replace(/[$\u20ac\u00a3\u00a5]/g, ' ');
    s = s.replace(/(\d),(\d)/g, '$1$2');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function bondCashflows(face, coupon, years, freq) {
    var n = Math.max(1, Math.round(years * freq));
    var cpn = face * coupon / freq;
    var cfs = [];
    for (var t = 1; t <= n; t++) cfs.push(t === n ? cpn + face : cpn);
    return cfs;
  }

  function bondPriceFromYtm(face, coupon, years, freq, ytmAnnual) {
    var cfs = bondCashflows(face, coupon, years, freq);
    var y = ytmAnnual / freq, p = 0;
    for (var t = 0; t < cfs.length; t++) p += cfs[t] / Math.pow(1 + y, t + 1);
    return p;
  }

  function bondYtmFromPrice(face, coupon, years, freq, price) {
    if (!(price > 0)) fail('Price must be a positive number.');
    var lo = -0.999, hi = 10;
    var plo = bondPriceFromYtm(face, coupon, years, freq, lo);
    var phi = bondPriceFromYtm(face, coupon, years, freq, hi);
    if (!(plo > price && phi < price)) fail("I couldn't find a yield for that price.");
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (bondPriceFromYtm(face, coupon, years, freq, mid) > price) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Macaulay duration (years), modified duration, annual convexity
  function bondStats(face, coupon, years, freq, ytmAnnual) {
    var cfs = bondCashflows(face, coupon, years, freq);
    var y = ytmAnnual / freq, p = 0, w = 0, c = 0;
    for (var t = 1; t <= cfs.length; t++) {
      var pv = cfs[t - 1] / Math.pow(1 + y, t);
      p += pv; w += t * pv; c += t * (t + 1) * pv;
    }
    var macaulay = (w / p) / freq;
    return {
      price: p,
      macaulay: macaulay,
      modified: macaulay / (1 + y),
      convexity: (c / p) / Math.pow(1 + y, 2) / (freq * freq)
    };
  }

  function fmtMoney(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(x, digits) {
    return (x * 100).toFixed(digits == null ? 3 : digits) + '%';
  }

  function parseBondParams(rest) {
    function grab(re) { var m = rest.match(re); return m ? parseFloat(m[1]) : null; }
    var p = { face: 1000, freq: 2, freqName: 'semiannual' };

    var mf = grab(/\b(?:face|par)(?:\s+value)?\s+(\d+(?:\.\d+)?)/);
    if (mf != null) p.face = mf;
    if (!(p.face > 0)) fail('Face value must be positive.');

    var mc = rest.match(/\bcoupon\s+(\d+(?:\.\d+)?)\s*%/) || rest.match(/(\d+(?:\.\d+)?)\s*%\s+coupon\b/);
    if (mc) p.coupon = parseFloat(mc[1]) / 100;
    else {
      var mc2 = grab(/\bcoupon\s+(\d+(?:\.\d+)?)/);
      if (mc2 != null) p.coupon = mc2 > 1 ? mc2 / 100 : mc2;
    }
    if (p.coupon == null) fail("I need a coupon rate \u2014 e.g. 'coupon 5%'.");
    if (p.coupon < 0) fail('Coupon rate must be zero or positive.');

    var yrs = grab(/\b(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/) || grab(/\bmaturity\s+(\d+(?:\.\d+)?)/);
    if (yrs == null) fail("I need years to maturity \u2014 e.g. '10 years'.");
    if (!(yrs > 0) || yrs > 100) fail('Years to maturity must be between 0 and 100.');
    p.years = yrs;

    if (/\bquarterly\b/.test(rest)) { p.freq = 4; p.freqName = 'quarterly'; }
    else if (/\bmonthly\b/.test(rest)) { p.freq = 12; p.freqName = 'monthly'; }
    else if (/\bannual\b/.test(rest)) { p.freq = 1; p.freqName = 'annual'; }

    var my = rest.match(/\b(?:yield|ytm)\s+(\d+(?:\.\d+)?)\s*%/) || rest.match(/(\d+(?:\.\d+)?)\s*%\s+(?:yield|ytm)\b/);
    if (my) p.ytm = parseFloat(my[1]) / 100;
    else {
      var my2 = grab(/\b(?:yield|ytm)\s+(\d+(?:\.\d+)?)/);
      if (my2 != null) p.ytm = my2 > 1 ? my2 / 100 : my2;
    }

    var mp = grab(/\bprice\s+(\d+(?:\.\d+)?)/);
    if (mp != null) p.price = mp;

    return p;
  }

  // Returns a bond result, or null when the input isn't a bond query.
  function tryBond(s) {
    var t = s.replace(/^(what is|what's|whats|calculate|compute|please)\s+/, '').replace(/^the\s+/, '');
    if (!/^bond\b/.test(t)) return null;
    var rest = t.replace(/^bond\s*/, '').replace(/(\d)\s*-\s*(?=years?\b)/g, '$1 ');
    var cmd = null;
    var mcmd = rest.match(/^(price|pricing|ytms?|yields?|duration|convexity|convex)\b/);
    if (mcmd) {
      var w = mcmd[1];
      cmd = (w === 'price' || w === 'pricing') ? 'price'
          : (w === 'duration') ? 'duration'
          : (w === 'convexity' || w === 'convex') ? 'convexity' : 'ytm';
      rest = rest.slice(mcmd[0].length).trim();
    }
    var p = parseBondParams(rest);
    // tolerate the subcommand doubling as the known quantity
    if (cmd === 'price' && p.ytm == null && p.price != null) cmd = 'ytm';
    if (cmd === 'ytm' && p.price == null && p.ytm != null) cmd = 'price';
    if (!cmd) cmd = (p.price != null) ? 'ytm' : 'price';

    var spec = 'face ' + fmtMoney(p.face) + ' \u00b7 ' + fmtPct(p.coupon, 2) + ' coupon \u00b7 ' +
               p.years + ' yrs ' + p.freqName;
    var ytmAnnual, stats, extras;
    if (cmd === 'price') {
      if (p.ytm == null) fail("I need a yield to price the bond \u2014 e.g. 'yield 6%'.");
      ytmAnnual = p.ytm;
      stats = bondStats(p.face, p.coupon, p.years, p.freq, ytmAnnual);
      extras = 'Macaulay duration ' + stats.macaulay.toFixed(2) + ' yrs, modified ' +
               stats.modified.toFixed(2) + ', convexity ' + stats.convexity.toFixed(2);
      return { ok: true, kind: 'bond', value: stats.price, display: fmtMoney(stats.price),
               interpretation: 'Bond price \u00b7 ' + spec + ' \u00b7 ' + fmtPct(ytmAnnual, 2) +
                 ' yield \u2014 ' + extras };
    }
    if (cmd === 'ytm') {
      if (p.price == null) fail("I need a price to find the yield \u2014 e.g. 'price 950'.");
      ytmAnnual = bondYtmFromPrice(p.face, p.coupon, p.years, p.freq, p.price);
      stats = bondStats(p.face, p.coupon, p.years, p.freq, ytmAnnual);
      extras = 'Macaulay duration ' + stats.macaulay.toFixed(2) + ' yrs, modified ' +
               stats.modified.toFixed(2) + ', convexity ' + stats.convexity.toFixed(2);
      return { ok: true, kind: 'bond', value: ytmAnnual, display: 'YTM ' + fmtPct(ytmAnnual),
               interpretation: 'Yield to maturity \u00b7 ' + spec + ' \u00b7 price ' +
                 fmtMoney(p.price) + ' \u2014 ' + extras };
    }
    if (p.ytm == null) fail("I need a yield for that \u2014 e.g. 'yield 6%'.");
    ytmAnnual = p.ytm;
    stats = bondStats(p.face, p.coupon, p.years, p.freq, ytmAnnual);
    if (cmd === 'duration') {
      return { ok: true, kind: 'bond', value: stats.macaulay,
               display: stats.macaulay.toFixed(2) + ' years',
               interpretation: 'Macaulay duration \u00b7 ' + spec + ' \u00b7 ' + fmtPct(ytmAnnual, 2) +
                 ' yield \u2014 modified duration ' + stats.modified.toFixed(2) + ' yrs' };
    }
    return { ok: true, kind: 'bond', value: stats.convexity,
             display: stats.convexity.toFixed(2),
             interpretation: 'Convexity \u00b7 ' + spec + ' \u00b7 ' + fmtPct(ytmAnnual, 2) + ' yield' };
  }

  /* ---------------- equation solving (linear) ---------------- */
  function solveEquation(text) {
    var parts = text.split('=');
    if (parts.length !== 2) fail("I can only solve equations with a single '='.");
    var L = parts[0].trim(), R = parts[1].trim();
    if (!L || !R) fail('An equation needs an expression on both sides.');
    function f(x) { return evaluate(L, { solve: true, x: x }) - evaluate(R, { solve: true, x: x }); }
    var f0 = f(0), f1 = f(1);
    if (!isFinite(f0) || !isFinite(f1)) fail("I couldn't solve that equation.");
    if (Math.abs(f1 - f0) < 1e-12) {
      if (Math.abs(f0) < 1e-9) fail('Every value of x satisfies that equation.');
      fail('No value of x satisfies that equation.');
    }
    var x = -f0 / (f1 - f0);
    var check = f(2), predicted = f0 + 2 * (f1 - f0);
    if (Math.abs(check - predicted) > 1e-6 * Math.max(1, Math.abs(f0), Math.abs(predicted)))
      fail('I can only solve linear equations so far.');
    return { ok: true, kind: 'solve', value: x, display: 'x = ' + formatNumber(x), interpretation: pretty(text) };
  }

  /* ---------------- formatting ---------------- */
  function formatNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) fail('The result is not a finite number.');
    if (n === 0) return '0';
    var abs = Math.abs(n);
    if (abs >= 1e15 || abs < 1e-6) {
      return n.toExponential(6).replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
    }
    if (Math.round(n) === n && abs < 1e15) return n.toLocaleString('en-US');
    return String(parseFloat(n.toPrecision(10)));
  }

  /* ---------------- public API ---------------- */
  function calculate(rawInput, lastAns) {
    try {
      var bond = tryBond(lightNormalize(rawInput));
      if (bond) return bond;

      var pre = preprocess(rawInput);
      if (!pre.text) return { ok: false, error: 'Type something to calculate \u2014 try "15% of 240".' };

      var conv = tryConversion(pre.text);
      if (conv) {
        return {
          ok: true, kind: 'conversion', value: conv.result,
          display: formatNumber(conv.value) + ' ' + conv.from + ' = ' + formatNumber(conv.result) + ' ' + conv.to,
          interpretation: pretty(pre.text)
        };
      }

      if (pre.text.indexOf('=') >= 0) return solveEquation(pre.text);
      if (pre.solveMode) {  // "solve 2+2" with no '=': just evaluate
        var sv = evaluate(pre.text, { ans: lastAns });
        if (!isFinite(sv)) fail('The result is not a finite number.');
        return { ok: true, kind: 'math', value: sv, display: formatNumber(sv), interpretation: pretty(pre.text) };
      }

      var value = evaluate(pre.text, { ans: lastAns });
      if (!isFinite(value)) fail('The result is not a finite number.');
      return { ok: true, kind: 'math', value: value, display: formatNumber(value), interpretation: pretty(pre.text) };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : 'Something went wrong.' };
    }
  }

  var api = { calculate: calculate, formatNumber: formatNumber, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.CalcEngine = api;
  else globalThis.CalcEngine = api;
})();
