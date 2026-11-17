#!/usr/bin/env python3
"""Direct-parse Form 13F filings from EDGAR (the WhaleWisdom way).

The SEC's bulk 13F data sets (used by build-13f.py) lag ~6 weeks behind
the filing deadline because they're published by filing window. This
script instead discovers the season's 13F-HR / 13F-HR/A filings in
EDGAR's quarterly full index, downloads each filing's complete
submission .txt, and extracts the information table itself — so the
site can carry the new quarter within days of the deadline.

Output: ~/workspace/13f/edgar-agg.json in the same shape build-13f.py's
aggregation cache uses (agg / mgr_name / name_cusip), restricted to the
filings' actual report periods. build-13f.py merges it over the bulk
cache (this source wins for any period it covers).

Resumable: every parsed filing is appended to
~/workspace/13f/edgar-filings.jsonl; rerunning skips accessions already
recorded. Delete both files to start a season over.

Usage:
  python3 tools/parse-13f-edgar.py [--year 2026 --qtr 4] [--limit N]
EDGAR fair access: descriptive User-Agent, <= ~8 requests/second.
"""
import argparse, json, os, re, sys, threading, time
import urllib.request, urllib.error
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

SCRATCH = os.path.expanduser("~/workspace/13f")
OUT = os.path.join(SCRATCH, "edgar-agg.json")
JSONL = os.path.join(SCRATCH, "edgar-filings.jsonl")
BULK_CACHE = os.path.join(SCRATCH, "agg-cache.json")
ALIASES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "13f-aliases.json")
UA = {"User-Agent": "willtran.org research contact@example.com"}
RATE = threading.Semaphore(1)
LAST = [0.0]

def fetch(url, tries=3):
    for i in range(tries):
        # global pacing: one request every 0.13s (~7.7/s)
        with RATE:
            wait = LAST[0] + 0.13 - time.time()
            if wait > 0:
                time.sleep(wait)
            LAST[0] = time.time()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))

# ------------------------------------------------------------- discovery
def discover(year, qtr):
    cache = os.path.join(SCRATCH, f"form-{year}q{qtr}.idx")
    if os.path.exists(cache):
        text = open(cache, errors="replace").read()
    else:
        url = f"https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{qtr}/form.idx"
        print("fetching", url)
        text = fetch(url).decode("utf-8", errors="replace")
        open(cache, "w").write(text)
    out = []
    for line in text.splitlines():
        if not line.startswith("13F-HR"):
            continue
        parts = line.split()
        # last three tokens are CIK, date filed, path — robust to the
        # fixed-width padding inside the company-name column.
        if len(parts) < 4 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", parts[-2]):
            continue
        form, cik, fdate, path = parts[0], parts[-3], parts[-2], parts[-1]
        if form not in ("13F-HR", "13F-HR/A") or not cik.isdigit():
            continue
        acc = path.rsplit("/", 1)[-1].replace(".txt", "")
        out.append({"form": form, "cik": cik, "fdate": fdate,
                    "path": path, "acc": acc})
    print(f"discovered {len(out)} 13F-HR(/A) filings")
    return out

# ------------------------------------------------------------- parsing
HDR = {
    "period": re.compile(r"CONFORMED PERIOD OF REPORT:\s*(\d{8})"),
    "name": re.compile(r"COMPANY CONFORMED NAME:\s*(.+)", ),
}
# Many filers' software emits namespace-prefixed tags (<ns1:infoTable>,
# <ns1:cusip>, ...). All element regexes must tolerate an optional prefix.
NS = r"(?:[A-Za-z0-9]+:)?"
ROW = re.compile(rf"<{NS}infoTable>(.*?)</{NS}infoTable>", re.S | re.I)
def field(block, tag):
    m = re.search(rf"<{NS}{tag}>([^<]*)</{NS}{tag}>", block, re.I)
    return m.group(1).strip() if m else ""

def parse_filing(f, known_cusips):
    url = "https://www.sec.gov/Archives/" + f["path"].lstrip("/")
    raw = fetch(url).decode("utf-8", errors="replace")
    head = raw[:6000]
    pm = HDR["period"].search(head)
    if not pm:
        return {"acc": f["acc"], "skip": "no-period"}
    period = f"{pm.group(1)[:4]}-{pm.group(1)[4:6]}-{pm.group(1)[6:]}"
    nm = HDR["name"].search(head)
    name = nm.group(1).strip() if nm else ""
    amend = f["form"].endswith("/A")
    atype = ""
    if amend:
        am = re.search(rf"<{NS}amendmentType>([^<]+)</{NS}amendmentType>", raw, re.I)
        atype = am.group(1).strip().upper() if am else "RESTATEMENT"
    # locate the information table document
    rows, names = {}, Counter()
    for doc in re.finditer(r"<DOCUMENT>(.*?)</DOCUMENT>", raw, re.S):
        block = doc.group(1)
        if "informationtable" not in block.lower():  # no "<": prefixed tags read <ns1:informationTable
            continue
        for rm in ROW.finditer(block):
            r = rm.group(1)
            if field(r, "sshPrnamtType") != "SH" or field(r, "putCall"):
                continue
            cusip = field(r, "cusip").upper()
            if not cusip:
                continue
            try:
                sh = int(float(field(r, "sshPrnamt")))
                val = int(float(field(r, "value")))
            except ValueError:
                continue
            issuer = field(r, "nameOfIssuer")
            names[(issuer, cusip)] += 1
            if cusip in known_cusips:
                cur = rows.setdefault(cusip, [0, 0])
                cur[0] += sh; cur[1] += val
    return {"acc": f["acc"], "cik": f["cik"], "period": period,
            "fdate": f["fdate"], "name": name, "amend": amend,
            "atype": atype, "rows": rows,
            "names": [[k[0], k[1], v] for k, v in names.items()]}

# ------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--qtr", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refetch-empty", action="store_true",
                    help="drop JSONL records with zero parsed rows and fetch them again")
    args = ap.parse_args()

    known = set()
    if os.path.exists(BULK_CACHE):
        bulk = json.load(open(BULK_CACHE))
        for k in bulk["name_cusip"]:
            known.add(k.split("\t")[1].upper())
    if os.path.exists(ALIASES):
        for v in json.load(open(ALIASES)).values():
            known.add(v.upper())
    print("known cusips:", len(known))

    done = {}
    if os.path.exists(JSONL):
        kept = []
        for line in open(JSONL):
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if args.refetch_empty and "rows" in rec and not rec["rows"]:
                continue  # likely a namespace-prefix parse miss; fetch again
            done[rec["acc"]] = rec
            kept.append(line)
        if args.refetch_empty:
            with open(JSONL, "w") as f:
                f.writelines(kept)
    print("already parsed:", len(done))

    filings = discover(args.year, args.qtr)
    todo = [f for f in filings if f["acc"] not in done]
    if args.limit:
        todo = todo[:args.limit]
    print("to fetch:", len(todo))

    lock = threading.Lock()
    out = open(JSONL, "a")
    n_ok = n_err = 0
    def work(f):
        nonlocal n_ok, n_err
        try:
            rec = parse_filing(f, known)
        except Exception as e:
            with lock:
                n_err += 1
                if n_err <= 10:
                    print("ERR", f["acc"], repr(e)[:100])
            return
        with lock:
            out.write(json.dumps(rec) + "\n"); out.flush()
            done[rec["acc"]] = rec
            n_ok += 1
            if n_ok % 250 == 0:
                print(f"  {n_ok} ok, {n_err} err", flush=True)
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(work, todo))
    out.close()
    print(f"fetched {n_ok}, errors {n_err}, total records {len(done)}")
    if args.limit:
        return

    # ---- select effective filings per (cik, period), same rules as bulk
    groups = defaultdict(list)
    for rec in done.values():
        if "rows" in rec:
            groups[(rec["cik"], rec["period"])].append(rec)
    selected = []
    for key, items in groups.items():
        items.sort(key=lambda r: r["fdate"])
        restate = [r for r in items if r["amend"] and "RESTATE" in r["atype"]]
        if restate:
            chosen = [restate[-1]]
        else:
            originals = [r for r in items if not r["amend"]]
            newhold = [r for r in items if r["amend"] and "NEW" in r["atype"]]
            chosen = (originals[-1:] + newhold) if originals else [items[-1]]
        selected.extend(chosen)
    print("effective filings:", len(selected))

    # name keys must match build-13f.py's cache format: norm_name + cusip
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "b13f", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build-13f.py"))
    b13f = importlib.util.module_from_spec(spec); spec.loader.exec_module(b13f)

    agg, mgr_name, name_cusip = {}, {}, Counter()
    for rec in selected:
        mgr_name[rec["cik"]] = rec["name"]
        for cusip, (sh, val) in rec["rows"].items():
            key = f'{rec["period"]}|{cusip}|{rec["cik"]}'
            cur = agg.setdefault(key, [0, 0])
            cur[0] += sh; cur[1] += val
        for issuer, cusip, cnt in rec["names"]:
            name_cusip[f"{b13f.norm_name(issuer)}\t{cusip}"] += cnt
    periods = sorted({r["period"] for r in selected})
    print("periods covered:", periods)
    json.dump({"agg": agg, "mgr_name": mgr_name,
               "name_cusip": dict(name_cusip), "periods": periods},
              open(OUT, "w"))
    print("wrote", OUT)

    # AAMI spot check for the newest period
    cur = periods[-1]
    aami = {k: v for k, v in agg.items() if k.startswith(cur + "|10948W103|")}
    print(f"AAMI {cur}: holders {len(aami)}")
    top = sorted(aami.items(), key=lambda kv: -kv[1][0])[:5]
    for k, v in top:
        print("  ", mgr_name.get(k.split("|")[2], "?"), f"{v[0]:,}")

if __name__ == "__main__":
    main()
