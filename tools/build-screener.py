#!/usr/bin/env python3
"""Build js/screener-data.js: one row per GICS ticker with valuation,
growth, profitability, yield and price-position fields.

Sources (all free, no keys):
- Universe + sector/industry: js/gics.js (3,002 tickers)
- Names: SEC company_tickers.json (~/workspace/13f/company_tickers.json)
- Fundamentals: Finnhub /stock/metric?metric=all via the live worker
  (60 calls/min on the free tier — paced ~1.05s; the worker caches each
  symbol 24h, so reruns are cheap). ~55 min for a full pass.
- Last price + day change: Yahoo chart API, range=5d (no key).

Output: var SCR_META={gen, count, asOf}; var SCR=[ [sym, name, sector,
industry, mcapM, pe, ps, pb, divYield, beta, epsTTM, revGrowth,
grossMargin, roe, price, dayChg, pos52w], ... ] — null where unknown.
Finnhub metric values are already in percent units (grossMarginTTM
48.79 means 48.79%), so they are stored as-is.

Resume: progress in ~/workspace/13f/screener-progress.jsonl, one JSON
line per finished ticker; a killed run resumes instead of restarting.
Run: cd ~/workspace/willtran-site && nohup python3 tools/build-screener.py > ~/workspace/13f/screener.log 2>&1 &
"""
import json
import os
import re
import sys
import threading
import time
import urllib.request

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRATCH = os.path.expanduser("~/workspace/13f")
WORKER = "https://willtran-stocks-proxy.willtran98.workers.dev"
PROGRESS = os.path.join(SCRATCH, "screener-progress.jsonl")
OUT = os.path.join(SITE, "js", "screener-data.js")
UA = {"User-Agent": "willtran.org research contact@example.com"}
YAHOO_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# Row field order (keep in sync with js/screener.js):
# 0 sym, 1 name, 2 sector, 3 industry, 4 mcapM, 5 pe, 6 ps, 7 pb,
# 8 divYield, 9 beta, 10 epsTTM, 11 revGrowth, 12 grossMargin, 13 roe,
# 14 price, 15 dayChg, 16 pos52w


def get_json(url, headers, timeout=30):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def num(x):
    try:
        v = float(x)
        return v if v == v and abs(v) != float("inf") else None
    except (TypeError, ValueError):
        return None


def one_ticker(sym, gics_entry, name):
    """Fetch metric + price for one ticker. Returns a row list."""
    row = [sym, name, gics_entry.get("s"), gics_entry.get("i"),
           None, None, None, None, None, None, None, None, None, None,
           None, None, None]
    metric = {}
    try:
        d = get_json(WORKER + "/metric?symbol=" + sym + "&metric=all", UA)
        metric = d.get("metric") or {}
    except Exception as e:
        print(f"  metric fail {sym}: {e}", flush=True)
    if metric:
        row[4] = num(metric.get("marketCapitalization"))
        row[5] = num(metric.get("peBasicExclExtraTTM") or metric.get("peTTM"))
        row[6] = num(metric.get("psTTM"))
        row[7] = num(metric.get("pb"))
        row[8] = num(metric.get("dividendYieldIndicatedAnnual"))
        row[9] = num(metric.get("beta"))
        row[10] = num(metric.get("epsTTM"))
        row[11] = num(metric.get("revenueGrowthTTMYoy"))
        row[12] = num(metric.get("grossMarginTTM"))
        row[13] = num(metric.get("roeTTM"))
        hi, lo = num(metric.get("52WeekHigh")), num(metric.get("52WeekLow"))
    else:
        hi = lo = None
    try:
        y = get_json("https://query2.finance.yahoo.com/v8/finance/chart/" +
                     sym + "?range=5d&interval=1d", YAHOO_UA, timeout=20)
        res = y["chart"]["result"][0]
        closes = [c for c in (res["indicators"]["quote"][0]["close"] or [])
                  if c is not None]
        if closes:
            price = closes[-1]
            row[14] = round(price, 2)
            if len(closes) > 1 and closes[-2]:
                row[15] = round((price / closes[-2] - 1) * 100, 2)
            if hi and lo and hi > lo:
                row[16] = round((price - lo) / (hi - lo) * 100, 1)
    except Exception as e:
        print(f"  yahoo fail {sym}: {e}", flush=True)
    return row


def main():
    with open(os.path.join(SITE, "js", "gics.js")) as f:
        gics = json.loads(re.search(r"var GICS=(\{.*\});?\s*$", f.read(), re.S).group(1))
    names = {}
    tickers_path = os.path.join(SCRATCH, "company_tickers.json")
    if os.path.exists(tickers_path):
        with open(tickers_path) as f:
            for rec in json.load(f).values():
                t = str(rec.get("ticker", "")).upper()
                if t and "-" not in t:
                    names[t] = rec.get("title", "")
    # Dash tickers in EDGAR are GICS dot form (BRK-B -> BRK.B)
    names_dot = {t.replace("-", "."): n for t, n in names.items()}
    names.update(names_dot)

    done = {}
    if os.path.exists(PROGRESS):
        for line in open(PROGRESS):
            try:
                r = json.loads(line)
                done[r[0]] = r
            except ValueError:
                pass
    print(f"universe {len(gics)}; already done {len(done)}", flush=True)
    todo = [s for s in sorted(gics) if s not in done]
    print(f"to fetch: {len(todo)}", flush=True)
    lock = threading.Lock()
    with open(PROGRESS, "a") as pf:
        for i, sym in enumerate(todo):
            row = one_ticker(sym, gics[sym], names.get(sym, ""))
            with lock:
                done[sym] = row
                pf.write(json.dumps(row) + "\n")
                pf.flush()
            if (i + 1) % 50 == 0:
                print(f"  {i + 1}/{len(todo)} done ({sym})", flush=True)
            time.sleep(1.05)  # Finnhub free tier: 60 calls/min
    rows = [done[s] for s in sorted(done)]
    with open(OUT, "w") as f:
        f.write("/* Screener dataset — generated by tools/build-screener.py.\n"
                "   Row: [sym, name, sector, industry, mcapM, pe, ps, pb,\n"
                "   divYield, beta, epsTTM, revGrowth, grossMargin, roe,\n"
                "   price, dayChg, pos52w]. Do not edit by hand. */\n")
        f.write("var SCR_META=" + json.dumps({
            "gen": time.strftime("%Y-%m-%d"),
            "count": len(rows),
            "asOf": time.strftime("%Y-%m-%d")}) + ";\n")
        f.write("var SCR=" + json.dumps(rows, separators=(",", ":")) + ";\n")
    print(f"wrote {OUT} ({len(rows)} tickers)", flush=True)


if __name__ == "__main__":
    main()
