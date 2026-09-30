#!/usr/bin/env python3
"""Rebuild js/gics.js from a Russell 3000 GICS holdings spreadsheet.

Usage:  python3 build-gics.py /path/to/mappings.xlsx

The spreadsheet is a 4-level hierarchy (Sector > Industry Group > Industry >
Sub-Industry) with stock rows (Symbol like 'AAPL-US') nested under their
sub-industry. This script walks it with a stack, resolving each header's level
against the GICS tree below (deepest valid level wins, so same-name
industry/sub-industry pairs like 'Banks' > 'Banks' resolve correctly).

File rows take precedence over the existing S&P 500 entries in js/gics.js.
Display names use official GICS spelling (commas restored).
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
GICS_JS = SITE / "js" / "gics.js"

# sector -> group -> industry -> [sub-industries], official GICS display names
# plus Russell "GICS Multi-Sourced" extras (marked R).
TREE = {
"Energy": {
  "Energy": {  # R: group named after the sector
    "Energy Equipment & Services": ["Oil & Gas Drilling", "Oil & Gas Equipment & Services"],
    "Oil, Gas & Consumable Fuels": ["Coal & Consumable Fuels", "Integrated Oil & Gas",
      "Oil & Gas Exploration & Production", "Oil & Gas Refining & Marketing",
      "Oil & Gas Storage & Transportation"]}},
"Materials": {
  "Materials": {
    "Chemicals": ["Commodity Chemicals", "Diversified Chemicals",
      "Fertilizers & Agricultural Chemicals", "Industrial Gases", "Specialty Chemicals"],
    "Construction Materials": ["Construction Materials"],
    "Containers & Packaging": ["Metal, Glass & Plastic Containers",
      "Paper & Plastic Packaging Products & Materials"],
    "Metals & Mining": ["Aluminum", "Copper", "Diversified Metals & Mining", "Gold",
      "Silver", "Steel"],
    "Paper & Forest Products": ["Forest Products", "Paper Products"]}},
"Industrials": {
  "Capital Goods": {
    "Aerospace & Defense": ["Aerospace & Defense"],
    "Building Products": ["Building Products"],
    "Construction & Engineering": ["Construction & Engineering"],
    "Electrical Equipment": ["Electrical Components & Equipment", "Heavy Electrical Equipment"],
    "Industrial Conglomerates": ["Industrial Conglomerates"],
    "Machinery": ["Agricultural & Farm Machinery",
      "Construction Machinery & Heavy Transportation Equipment",
      "Industrial Machinery & Supplies & Components"],
    "Trading Companies & Distributors": ["Trading Companies & Distributors"]},
  "Commercial & Professional Services": {
    "Commercial Services & Supplies": ["Commercial Printing", "Diversified Support Services",
      "Environmental & Facilities Services", "Office Services & Supplies",
      "Security & Alarm Services"],
    "Professional Services": ["Data Processing & Outsourced Services",  # R: under Industrials
      "Human Resource & Employment Services", "Research & Consulting Services"]},
  "Transportation": {
    "Air Freight & Logistics": ["Air Freight & Logistics"],
    "Ground Transportation": ["Cargo Ground Transportation", "Passenger Ground Transportation",
      "Rail Transportation"],
    "Marine Transportation": ["Marine Transportation"],
    "Passenger Airlines": ["Passenger Airlines"],
    "Transportation Infrastructure": ["Airport Services"]}},
"Consumer Discretionary": {
  "Automobiles & Components": {
    "Automobile Components": ["Automotive Parts & Equipment", "Tires & Rubber"],  # R name
    "Automobiles": ["Automobile Manufacturers", "Motorcycle Manufacturers"]},
  "Consumer Discretionary Distribution & Retail": {
    "Broadline Retail": ["Broadline Retail"],
    "Distributors": ["Distributors"],
    "Specialty Retail": ["Apparel Retail", "Automotive Retail", "Computer & Electronics Retail",
      "Home Improvement Retail", "Homefurnishing Retail", "Other Specialty Retail"]},
  "Consumer Durables & Apparel": {
    "Household Durables": ["Consumer Electronics", "Home Furnishings", "Homebuilding",
      "Household Appliances", "Housewares & Specialties"],
    "Leisure Products": ["Leisure Products"],
    "Textiles, Apparel & Luxury Goods": ["Apparel, Accessories & Luxury Goods", "Footwear"]},
  "Consumer Services": {
    "Diversified Consumer Services": ["Education Services", "Specialized Consumer Services"],
    "Hotels, Restaurants & Leisure": ["Casinos & Gaming", "Hotels, Resorts & Cruise Lines",
      "Leisure Facilities", "Restaurants"]}},
"Consumer Staples": {
  "Consumer Staples Distribution & Retail": {
    "Consumer Staples Distribution & Retail": ["Consumer Staples Merchandise Retail",
      "Food Distributors", "Food Retail"]},
  "Food, Beverage & Tobacco": {
    "Beverages": ["Brewers", "Distillers & Vintners", "Soft Drinks & Non-alcoholic Beverages"],
    "Food Products": ["Agricultural Products & Services", "Packaged Foods & Meats"],
    "Tobacco": ["Tobacco"]},
  "Household & Personal Products": {
    "Household Products": ["Household Products"],
    "Personal Care Products": ["Personal Care Products"]}},
"Health Care": {
  "Health Care Equipment & Services": {
    "Health Care Equipment & Supplies": ["Health Care Equipment", "Health Care Supplies"],
    "Health Care Providers & Services": ["Health Care Distributors", "Health Care Facilities",
      "Health Care Services", "Managed Health Care"],
    "Health Care Technology": ["Health Care Technology"]},
  "Pharmaceuticals, Biotechnology & Life Sciences": {
    "Biotechnology": ["Biotechnology"],
    "Life Sciences Tools & Services": ["Life Sciences Tools & Services"],
    "Pharmaceuticals": ["Pharmaceuticals"]}},
"Financials": {
  "Banks": {
    "Banks": ["Diversified Banks", "Regional Banks"]},
  "Financial Services": {
    "Capital Markets": ["Asset Management & Custody Banks", "Financial Exchanges & Data",
      "Investment Banking & Brokerage"],
    "Consumer Finance": ["Consumer Finance"],
    "Diversified Financial Services": ["Multi-Sector Holdings", "Specialized Finance",  # R split
      "Transaction & Payment Processing Services"],
    "Financial Services": ["Commercial & Residential Mortgage Finance"],  # R split
    "Mortgage Real Estate Investment Trusts (REITs)": ["Mortgage REITs"]},
  "Insurance": {
    "Insurance": ["Insurance Brokers", "Life & Health Insurance", "Multi-line Insurance",
      "Property & Casualty Insurance", "Reinsurance"]}},
"Information Technology": {
  "Semiconductors & Semiconductor Equipment": {
    "Semiconductors & Semiconductor Equipment": ["Semiconductor Materials & Equipment",
      "Semiconductors"]},
  "Software & Services": {
    "IT Services": ["Internet Services & Infrastructure", "IT Consulting & Other Services"],
    "Software": ["Application Software", "Systems Software"]},
  "Technology Hardware & Equipment": {
    "Communications Equipment": ["Communications Equipment"],
    "Electronic Equipment, Instruments & Components": ["Electronic Components",
      "Electronic Equipment & Instruments", "Electronic Manufacturing Services",
      "Technology Distributors"],
    "Technology Hardware, Storage & Peripherals": ["Technology Hardware, Storage & Peripherals"]}},
"Communication Services": {
  "Media & Entertainment": {
    "Entertainment": ["Interactive Home Entertainment", "Movies & Entertainment"],
    "Interactive Media & Services": ["Interactive Media & Services"],
    "Media": ["Advertising", "Broadcasting", "Cable & Satellite", "Publishing"]},
  "Telecommunication Services": {
    "Diversified Telecommunication Services": ["Alternative Carriers",
      "Integrated Telecommunication Services"],
    "Wireless Telecommunication Services": ["Wireless Telecommunication Services"]}},
"Utilities": {
  "Utilities": {  # R: group named after the sector
    "Electric Utilities": ["Electric Utilities"],
    "Gas Utilities": ["Gas Utilities"],
    "Independent Power and Renewable Electricity Producers": [
      "Independent Power Producers & Energy Traders", "Renewable Electricity"],
    "Multi-Utilities": ["Multi-Utilities"],
    "Water Utilities": ["Water Utilities"]}},
"Real Estate": {
  "Equity Real Estate Investment Trusts (REITs)": {
    "Diversified REITs": ["Diversified REITs"],
    "Health Care REITs": ["Health Care REITs"],
    "Hotel & Resort REITs": ["Hotel & Resort REITs"],
    "Industrial REITs": ["Industrial REITs"],
    "Office REITs": ["Office REITs"],
    "Residential REITs": ["Multi-Family Residential REITs", "Single-Family Residential REITs"],
    "Retail REITs": ["Retail REITs"],
    "Specialized REITs": ["Data Center REITs", "Other Specialized REITs",
      "Self-Storage REITs", "Telecom Tower REITs", "Timber REITs"]},
  "Real Estate Management & Development": {
    "Real Estate Management & Development": ["Diversified Real Estate Activities",
      "Real Estate Development", "Real Estate Operating Companies",
      "Real Estate Services"]}},
}


def norm(name):
    n = name.lower()
    n = re.sub(r"[,.()]", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


# File spellings mapped to official GICS display names
DISPLAY_OVERRIDES = {
    norm("Automobile Components"): "Auto Components",
}

def build_lookup():
    # norm name -> list of (level, parent_canon, canon, display)
    # canon = normalized registered name; the stack stores canon so parent
    # links stay consistent even when the file spells a name differently.
    look = {}
    def add(nm, level, parent, display):
        display = DISPLAY_OVERRIDES.get(norm(nm), display)
        look.setdefault(norm(nm), []).append(
            (level, norm(parent) if parent else None, norm(nm), display))
    for sec, groups in TREE.items():
        add(sec, 0, None, sec)
        for grp, inds in groups.items():
            add(grp, 1, sec, grp)
            for ind, subs in inds.items():
                add(ind, 2, grp, ind)
                for sub in subs:
                    add(sub, 3, ind, sub)
    # Russell rename: file says "Automobile Components" (official: "Auto Components")
    # handled via DISPLAY_OVERRIDES above; tree key already matches the file.
    # Unclassified bucket used by the spreadsheet
    for lv in range(4):
        look.setdefault(norm("Unavailable"), []).append((lv, norm("Unavailable"), norm("Unavailable"), "Unavailable"))
    return look


def parse_sheet(path, look):
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    out = {}
    stack = []  # (level, norm, display)
    unplaced = []
    for row in ws.iter_rows(min_row=7, values_only=True):
        name, sym = row[0], row[1]
        if not name:
            continue
        if isinstance(name, str) and name.startswith("Data as of:"):
            break
        if sym and sym != "R.3000":
            if sym == "2925DUMM":
                continue
            ticker = sym[:-3] if sym.endswith("-US") else sym
            if len(stack) == 4 and stack[3][2] != "Unavailable":
                s, g, i, u = (x[2] for x in stack)
                out[ticker] = {"s": s, "i": i, "u": u}
            elif len(stack) >= 3 and stack[0][2] != "Unavailable":
                # industry-level only (no sub-industry in the file)
                out[ticker] = {"s": stack[0][2], "i": stack[2][2], "u": None}
            else:
                out[ticker] = {"s": None, "i": None, "u": None}
            continue
        if name in ("Russell 3000", "R.3000"):
            continue
        n = norm(name)
        cands = sorted(look.get(n, []), key=lambda c: -c[0])
        placed = False
        for level, parent_canon, canon, display in cands:
            if level == 0:
                stack = [(0, canon, display)]
                placed = True
                break
            if len(stack) >= level and stack[level - 1][1] == parent_canon:
                stack = stack[:level] + [(level, canon, display)]
                placed = True
                break
        if not placed:
            unplaced.append(name)
    return out, unplaced


def main():
    xlsx = Path(sys.argv[1])
    look = build_lookup()
    file_map, unplaced = parse_sheet(xlsx, look)
    print(f"tickers from spreadsheet: {len(file_map)}")
    if unplaced:
        print("UNPLACED HEADERS:", sorted(set(unplaced)))

    base = {}
    if GICS_JS.exists():
        txt = GICS_JS.read_text()
        base = json.loads(txt.split("=", 1)[1].rstrip().rstrip(";"))
    print(f"tickers in existing gics.js: {len(base)}")

    merged = dict(base)
    for sym, g in file_map.items():
        if g["s"]:
            merged[sym] = g  # spreadsheet wins
        elif sym not in merged:
            merged[sym] = {"s": None, "i": None, "u": None}

    src = xlsx.name
    head = (f"/* GICS Sector/Industry/Sub-Industry.\n"
            f"   S&P 500 base via Wikipedia; overlaid with {src} (Russell 3000, file wins).\n"
            f"   Generated by tools/build-gics.py. */\nvar GICS=")
    GICS_JS.write_text(head + json.dumps(merged, separators=(",", ":")) + ";\n")
    print(f"wrote {GICS_JS} ({len(merged)} tickers)")


if __name__ == "__main__":
    main()
