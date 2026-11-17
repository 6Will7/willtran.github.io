#!/usr/bin/env python3
"""Build js/13f-data.js from the SEC's official Form 13F data sets.

Pipeline (same pattern as build-gics.py / fetch-etf-holdings.py):
  1. Download the quarterly 13F data-set ZIPs (by filing window) into
     ~/workspace/13f/ — only the two most recent windows are needed.
  2. Pick the two most recent REPORT PERIODS with a full filing season.
  3. For each (manager CIK, period) pick the effective filing(s):
     latest RESTATEMENT amendment wins alone; otherwise the original
     13F-HR plus any NEW HOLDINGS amendments.
  4. Aggregate SH rows (no put/call) per (period, CUSIP, manager):
     shares + market value (VALUE is in dollars in the current spec).
  5. Map CUSIPs to tickers: EDGAR company_tickers.json names are
     normalized and matched against issuer names in the data set.
     Ambiguous share-class cases go in tools/13f-aliases.json
     ({"TICKER": "CUSIP"}), which always wins.
  6. Emit js/13f-data.js restricted to the GICS universe (js/gics.js):
     per ticker — totals, holder count, new/exited counts, top 20
     holders with QoQ share change, top 5 exits.

Usage: python3 tools/build-13f.py [--force-aggregate]
The aggregation pass over ~800MB of TSVs is cached in
~/workspace/13f/agg-cache.json; delete it (or pass --force-aggregate)
after downloading newer data-set windows.
"""
import csv, io, json, os, re, sys, zipfile
from collections import Counter, defaultdict
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
SCRATCH = os.path.expanduser("~/workspace/13f")
CACHE = os.path.join(SCRATCH, "agg-cache.json")
ALIASES = os.path.join(HERE, "13f-aliases.json")
UA = {"User-Agent": "willtran.org research contact@example.com"}

# ---------------------------------------------------------------- downloads
def ensure_inputs():
    import urllib.request
    os.makedirs(SCRATCH, exist_ok=True)
    have = [f for f in os.listdir(SCRATCH) if f.endswith("_form13f.zip")]
    if len(have) < 2:
        # The two most recent filing windows, per the SEC data-sets page.
        # (The newest window lives under a different path prefix.)
        urls = [
            "https://www.sec.gov/files/datastandardsinnovation/data/form-13f-data-sets/01jun2026-31aug2026_form13f.zip",
            "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
        ]
        for u in urls:
            fn = os.path.join(SCRATCH, os.path.basename(u))
            if not os.path.exists(fn):
                print("downloading", u)
                req = urllib.request.Request(u, headers=UA)
                with urllib.request.urlopen(req) as r, open(fn, "wb") as f:
                    f.write(r.read())
    tickers = os.path.join(SCRATCH, "company_tickers.json")
    if not os.path.exists(tickers):
        print("downloading company_tickers.json")
        req = urllib.request.Request("https://www.sec.gov/files/company_tickers.json", headers=UA)
        with urllib.request.urlopen(req) as r, open(tickers, "wb") as f:
            f.write(r.read())

def zips():
    return [os.path.join(SCRATCH, f) for f in sorted(os.listdir(SCRATCH))
            if f.endswith("_form13f.zip")]

def read_tsv(zpath, member):
    with zipfile.ZipFile(zpath) as z:
        with z.open(member) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
            yield from csv.DictReader(text, delimiter="\t")

# ---------------------------------------------------------------- dates
MON = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}
def parse_date(s):
    # "30-JUN-2026" / "31-JUL-2026"
    d, m, y = s.strip().split("-")
    return date(int(y), MON[m[:3].upper()], int(d))

# ---------------------------------------------------------------- aggregate
def aggregate():
    if os.path.exists(CACHE) and "--force-aggregate" not in sys.argv:
        print("using cached aggregation", CACHE)
        with open(CACHE) as f:
            return json.load(f)

    filings = {}   # accession -> dict
    for zp in zips():
        subs = {r["ACCESSION_NUMBER"]: r for r in read_tsv(zp, "SUBMISSION.tsv")}
        for r in read_tsv(zp, "COVERPAGE.tsv"):
            acc = r["ACCESSION_NUMBER"]
            sub = subs.get(acc)
            if not sub or not sub["PERIODOFREPORT"]:
                continue
            filings[acc] = {
                "cik": sub["CIK"],
                "period": parse_date(sub["PERIODOFREPORT"]).isoformat(),
                "fdate": parse_date(sub["FILING_DATE"]).isoformat(),
                "type": sub["SUBMISSIONTYPE"],
                "name": (r["FILINGMANAGER_NAME"] or "").strip(),
                "amend": (r["ISAMENDMENT"] or "").strip().upper() == "Y",
                "atype": (r["AMENDMENTTYPE"] or "").strip().upper(),
            }
    print("filings loaded:", len(filings))

    # Two most recent periods with a full season (>=3000 holdings reports).
    per_count = Counter(f["period"] for f in filings.values() if f["type"].startswith("13F-HR"))
    periods = sorted(p for p, c in per_count.items() if c >= 3000)
    cur, prev = periods[-1], periods[-2]
    print("periods:", prev, "->", cur, dict(per_count))

    # Effective filings per (cik, period).
    groups = defaultdict(list)
    for acc, f in filings.items():
        if f["period"] in (cur, prev) and f["type"].startswith("13F-HR"):
            groups[(f["cik"], f["period"])].append((acc, f))
    selected = {}  # accession -> period
    for (cik, period), items in groups.items():
        items.sort(key=lambda x: x[1]["fdate"])
        restate = [a for a, f in items if f["amend"] and "RESTATE" in f["atype"]]
        if restate:
            chosen = [restate[-1]]
        else:
            originals = [a for a, f in items if not f["amend"]]
            newhold = [a for a, f in items if f["amend"] and "NEW" in f["atype"]]
            chosen = (originals[-1:] + newhold) if originals else [items[-1][0]]
        for a in chosen:
            selected[a] = period
    print("effective filings:", len(selected))
    mgr_name = {}
    for acc in selected:
        f = filings[acc]
        mgr_name[f["cik"]] = f["name"]  # latest wins loosely; fine for display

    agg = defaultdict(lambda: [0, 0])          # (period, cusip, cik) -> [shares, value]
    name_cusip = Counter()                     # (norm_name, cusip) -> rows
    cusip_name = Counter()                     # (cusip, raw name) -> rows
    for zp in zips():
        for r in read_tsv(zp, "INFOTABLE.tsv"):
            period = selected.get(r["ACCESSION_NUMBER"])
            if not period:
                continue
            if r["SSHPRNAMTTYPE"] != "SH" or (r["PUTCALL"] or "").strip():
                continue
            try:
                sh = int(float(r["SSHPRNAMT"])); val = int(float(r["VALUE"]))
            except ValueError:
                continue
            cik = filings[r["ACCESSION_NUMBER"]]["cik"]
            cusip = (r["CUSIP"] or "").strip().upper()  # some filers file lowercase
            key = (period, cusip, cik)
            agg[key][0] += sh; agg[key][1] += val
            raw = (r["NAMEOFISSUER"] or "").strip()
            name_cusip[(norm_name(raw), cusip)] += 1
            cusip_name[(cusip, raw)] += 1
    print("aggregated rows:", len(agg))

    out = {
        "cur": cur, "prev": prev,
        "mgr_name": mgr_name,
        "agg": {"|".join(k): v for k, v in agg.items()},
        "name_cusip": {"\t".join(k): v for k, v in name_cusip.items()},
        "cusip_name": {"\t".join(k): v for k, v in cusip_name.items()},
    }
    with open(CACHE, "w") as f:
        json.dump(out, f)
    return out

# ---------------------------------------------------------------- name matching
ABBREV = {
    "MGMT": "MANAGEMENT", "HLDG": "HOLDING", "HLDGS": "HOLDINGS",
    "INTL": "INTERNATIONAL", "NATL": "NATIONAL", "TECHNOLOGIES": "TECHNOLOGY",
    "INDS": "INDUSTRIES", "SVCS": "SERVICES", "SYS": "SYSTEMS",
    "LABS": "LABORATORIES", "PPTYS": "PROPERTIES", "FINL": "FINANCIAL",
    "GRP": "GROUP", "BANC": "BANK", "CTRS": "CENTERS", "CTR": "CENTER",
}
DROP_TAIL = {"INC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED",
             "PLC", "LLC", "LLP", "LP", "PC", "COM", "COMMON", "STOCK", "ORD",
             "SHS", "SHARES", "NEW", "DEL", "DELAWARE", "PUBLIC"}
# State-of-incorporation tails some filers append ("US BANCORP DE",
# "BEL FUSE INC NJ"). Dropped only with >=3 tokens remaining context.
STATES = {"DE", "MD", "NJ", "TX", "NV", "MA", "OH", "PA", "CA", "NY", "NC",
          "SC", "GA", "FL", "VA", "WV", "CT", "RI", "VT", "NH", "ME", "AL",
          "MS", "TN", "KY", "IN", "IL", "WI", "MI", "MN", "IA", "MO", "KS",
          "NE", "SD", "ND", "MT", "WY", "UT", "ID", "AZ", "NM", "WA", "OR",
          "AK", "HI", "OK", "AR"}
def norm_name(s):
    s = s.upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    toks = [ABBREV.get(t, t) for t in s.split()]
    if toks and toks[0] == "THE":
        toks = toks[1:]
    # strip share-class tail: "CL A" / "CLASS B"
    if len(toks) >= 2 and toks[-2] in ("CL", "CLASS") and len(toks[-1]) == 1:
        toks = toks[:-2]
    while toks and (toks[-1] in DROP_TAIL or (toks[-1] in STATES and len(toks) > 2)):
        toks = toks[:-1]
    return " ".join(toks)

def build_ticker_map(data, universe):
    """Map universe tickers (GICS dot form, e.g. BRK.B) to CUSIPs.

    EDGAR tickers use dashes for share classes (BRK-B); convert to dots.
    Rules, in order: hand-verified aliases win; an exact normalized-name
    match maps when exactly one universe ticker shares the name; a
    token-multiset match is the fallback. Names shared by >1 universe
    ticker with no alias stay unmapped and are reported (share classes —
    add them to 13f-aliases.json from the TITLEOFCLASS evidence)."""
    best = {}
    for k, cnt in data["name_cusip"].items():
        nm, cusip = k.split("\t")
        if nm not in best or cnt > best[nm][1]:
            best[nm] = (cusip, cnt)
    aliases = {}
    if os.path.exists(ALIASES):
        with open(ALIASES) as f:
            aliases = json.load(f)
    with open(os.path.join(SCRATCH, "company_tickers.json")) as f:
        edgar = json.load(f)
    title = {}   # dot-form ticker -> company name
    for row in edgar.values():
        # EDGAR titles sometimes carry a state/country suffix: "... INC /DE/"
        name = re.sub(r"\s*/[A-Z]{2}/\s*$", "", row["title"])
        title[row["ticker"].replace("-", ".")] = name
    by_norm = defaultdict(list)
    for t, name in title.items():
        by_norm[norm_name(name)].append(t)

    tmap, unresolved = {}, {}
    for t in sorted(universe):
        if t in aliases:
            tmap[t] = aliases[t].upper()
            continue
        if t not in title:
            continue
        nm = norm_name(title[t])
        if nm not in best:
            continue
        inu = [x for x in by_norm[nm] if x in universe]
        if len(inu) == 1:
            tmap[t] = best[nm][0]
        elif len(inu) > 1:
            unresolved[t] = nm
    # token-multiset fallback (word-order variants, e.g. "BERKLEY W R",
    # "HORTON D R"): accept when one CUSIP dominates the candidate names.
    by_tokens = defaultdict(list)
    for nm in best:
        by_tokens[tuple(sorted(nm.split()))].append(nm)
    name_counts = {}
    for k, cnt in data["name_cusip"].items():
        nm, cusip = k.split("\t")
        name_counts[nm] = name_counts.get(nm, 0) + cnt
    for t in sorted(universe):
        if t in tmap or t in unresolved or t not in title:
            continue
        key = tuple(sorted(norm_name(title[t]).split()))
        cands = by_tokens.get(key, [])
        if not cands:
            continue
        per_cusip = Counter()
        for nm in cands:
            per_cusip[best[nm][0]] += name_counts.get(nm, 0)
        ranked = per_cusip.most_common()
        if len(ranked) == 1 or ranked[0][1] >= 10 * ranked[1][1]:
            tmap[t] = ranked[0][0]
    unmapped = [t for t in sorted(universe) if t not in tmap and t not in unresolved]
    return tmap, unresolved, unmapped

# ---------------------------------------------------------------- edgar merge
def merge_edgar(data):
    """Overlay tools/parse-13f-edgar.py output (direct-parsed filings).

    The bulk data sets lag ~6 weeks; the direct parse covers the newest
    quarter within days of the deadline. The EDGAR source wins only for
    periods NEWER than the bulk cache's current period — for older
    periods it holds just late filings and amendments, while the bulk
    set is complete."""
    path = os.path.join(SCRATCH, "edgar-agg.json")
    if not os.path.exists(path):
        return data
    with open(path) as f:
        ed = json.load(f)
    covered = {p for p in ed.get("periods", []) if p > data["cur"]}
    if not covered:
        return data
    # Bulk CIKs are zero-padded to 10 digits; the EDGAR parse keeps them bare.
    # Normalize before merging or no manager ever matches across quarters.
    def pad(k):
        p, c, cik = k.split("|")
        return f"{p}|{c}|{cik.zfill(10)}"
    agg = {k: v for k, v in data["agg"].items() if k.split("|")[0] not in covered}
    agg.update({pad(k): v for k, v in ed["agg"].items() if k.split("|")[0] in covered})
    mgr = dict(data["mgr_name"])
    mgr.update({cik.zfill(10): nm for cik, nm in ed["mgr_name"].items()})
    nc = Counter(data["name_cusip"])
    for k, v in ed["name_cusip"].items():
        nc[k] += v
    periods = sorted({k.split("|")[0] for k in agg})
    print("edgar overlay periods:", sorted(covered), "-> cur", periods[-1])
    return dict(data, agg=agg, mgr_name=mgr, name_cusip=dict(nc),
                cur=periods[-1], prev=periods[-2])

# ---------------------------------------------------------------- emit
def display_name(name):
    # Filers are inconsistent: "BlackRock, Inc." vs "STATE STREET CORP".
    # Title-case the all-caps ones, keeping short tokens (LLC, LP, FMR) as-is.
    if not name or any(c.islower() for c in name):
        return name
    dotted = {"CO.": "Co.", "INC.": "Inc.", "CORP.": "Corp."}
    out = []
    for tok in name.split(" "):
        if tok in dotted:
            out.append(dotted[tok])
        elif len(tok.strip(".,")) <= 3:
            out.append(tok)
        else:
            out.append(tok[:1].upper() + tok[1:].lower())
    return " ".join(out)

def main():
    ensure_inputs()
    data = merge_edgar(aggregate())
    cur, prev = data["cur"], data["prev"]
    mgr_name = data["mgr_name"]

    with open(os.path.join(SITE, "js", "gics.js")) as f:
        gics = json.loads(re.search(r"var GICS=(\{.*\});?\s*$", f.read(), re.S).group(1))
    universe = set(gics)
    tmap, unresolved, unmapped = build_ticker_map(data, universe)
    covered = {t for t in universe if t in tmap}
    print(f"GICS universe {len(universe)}; mapped {len(covered)} "
          f"({100.0 * len(covered) / len(universe):.1f}%); "
          f"share-class unresolved {len(unresolved)}; unmapped {len(unmapped)}")
    for t, nm in sorted(unresolved.items()):
        print("  UNRESOLVED", t, "->", nm)
    print("  unmapped sample:", unmapped[:25])

    cusip2ticker = {}
    for t in sorted(covered):
        if tmap[t] in cusip2ticker:
            print("  CUSIP COLLISION", tmap[t], cusip2ticker[tmap[t]], "vs", t)
        cusip2ticker.setdefault(tmap[t], t)

    # per-cusip holder tables per period
    holders = {cur: defaultdict(dict), prev: defaultdict(dict)}  # period -> cusip -> cik -> [sh, val]
    for k, (sh, val) in data["agg"].items():
        period, cusip, cik = k.split("|")
        if period not in holders:  # merged EDGAR agg spans many old periods; only cur/prev are emitted
            continue
        holders[period][cusip][cik] = (sh, val)

    out = {}
    for cusip, t in sorted(cusip2ticker.items(), key=lambda kv: kv[1]):
        ch = holders[cur].get(cusip, {})
        ph = holders[prev].get(cusip, {})
        if not ch:
            continue
        rows = []
        for cik, (sh, val) in ch.items():
            p = ph.get(cik)
            if p is None:
                chg = "NEW"
            elif p[0] > 0:
                chg = round(100.0 * (sh - p[0]) / p[0], 1)
                if chg == 0:
                    chg = 0.0  # avoid -0.0 in the output
            else:
                chg = "NEW"
            rows.append([display_name(mgr_name.get(cik, cik)), sh, val, chg])
        rows.sort(key=lambda r: -r[1])
        exits = [[display_name(mgr_name.get(cik, cik)), sh]
                 for cik, (sh, val) in ph.items() if cik not in ch]
        exits.sort(key=lambda r: -r[1])
        out[t] = {
            "t": sum(v[0] for v in ch.values()),
            "p": sum(v[0] for v in ph.values()),
            "v": sum(v[1] for v in ch.values()),
            "n": len(ch),
            "nn": sum(1 for cik in ch if cik not in ph),
            "nx": len(exits),
            "h": rows[:20],
            "x": exits[:5],
        }
    meta = {"period": cur, "prev": prev, "gen": date.today().isoformat()}
    dest = os.path.join(SITE, "js", "13f-data.js")
    with open(dest, "w") as f:
        f.write("/* Institutional holders from SEC Form 13F data sets.\n")
        f.write("   Generated by tools/build-13f.py — do not edit by hand. */\n")
        f.write("var F13_META=" + json.dumps(meta, separators=(",", ":")) + ";\n")
        f.write("var F13=" + json.dumps(out, separators=(",", ":")) + ";\n")
    print("wrote", dest, f"({os.path.getsize(dest) / 1e6:.2f} MB, {len(out)} tickers)")

    aami = out.get("AAMI")
    if aami:
        print("\nAAMI check — holders:", aami["n"], "new:", aami["nn"], "exited:", aami["nx"],
              "total shares:", f"{aami['t']:,}")
        for r in aami["h"][:6]:
            print("  ", r)

if __name__ == "__main__":
    main()
