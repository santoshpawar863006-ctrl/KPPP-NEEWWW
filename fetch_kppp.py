import json, os, time
from datetime import datetime, timezone
from pathlib import Path
import requests

BASE = "https://kppp.karnataka.gov.in"
SEARCH = BASE + "/supplier-registration-service/v1/api/portal-service/search-eproc-tenders"
OUT = Path("public/tenders.json")
TOKEN = os.getenv("KPPP_AUTH_TOKEN", "").strip()
PAGE_SIZE = int(os.getenv("KPPP_PAGE_SIZE", "100"))
MAX_PAGES = int(os.getenv("KPPP_MAX_PAGES", "250"))
CATEGORIES = ["WORKS", "GOODS", "SERVICES"]


def headers():
    h = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": BASE,
        "Referer": BASE + "/",
        "Post": "CONTRACTOR-EPROC-CONTRACTOR",
        "User-Agent": "Mozilla/5.0 KPPP-Tender-Aggregator/1.0",
    }
    if TOKEN:
        h["Authorization"] = "Bearer " + TOKEN
    return h


def pick(d, *keys, default=""):
    if not isinstance(d, dict): return default
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return default


def find_list(obj):
    if isinstance(obj, list): return obj
    if not isinstance(obj, dict): return []
    for k in ("content", "items", "results", "tenders", "records", "data"):
        v = obj.get(k)
        if isinstance(v, list) and len(v) > 0: return v
        if isinstance(v, dict):
            nested = find_list(v)
            if nested: return nested
    return []


def number(v):
    try:
        return float(str(v).replace(",", "").replace("₹", "").strip())
    except Exception:
        return None


def normalize(x, cat_default):
    tid = str(pick(x, "id", "tenderId", "tenderID", "tenderPk", "tenderNumber", "tenderNo", default="")).strip()
    ref = str(pick(x, "tenderNumber", "tenderNo", "tenderReferenceNumber", "referenceNumber", "nitNumber", default=tid)).strip()
    title = str(pick(x, "tenderTitle", "title", "workDescription", "description", "tenderDescription", "name", default="Tender"))
    amount = pick(x, "estimatedContractValue", "estimatedAmount", "estimatedTenderValue", "tenderValue", "estimatedCost", "provisionalAmount", "amount", default="")
    location = str(pick(x, "locationName", "location", "districtName", "district", "placeOfWork", default="Karnataka"))
    district = str(pick(x, "districtName", "district", "district_name", default=""))
    city = str(pick(x, "cityName", "city", "townName", "town", "talukName", "taluk", default=""))
    department = str(pick(x, "departmentName", "department", "departmentNameEn", "organisationName", "organisation", "organization", "procuringEntity", default="Karnataka Government"))
    close = str(pick(x, "tenderClosureDate", "closingDate", "bidSubmissionEndDate", "submissionEndDate", "lastDate", "tenderEndDate", default=""))
    publish = str(pick(x, "publishedDate", "publishDate", "dateOfPublication", "tenderPublishDate", default=""))
    emd = pick(x, "emdAmount", "emd", "emdValue", default="")
    fee = pick(x, "tenderFee", "tenderFeeAmount", "fee", default="")

    # Standardize category name
    raw_cat = str(pick(x, "category", "tenderCategory", "categoryName", default=cat_default)).strip().upper()

    return {
        "id": tid,
        "ref_no": ref,
        "title": title,
        "category": raw_cat,
        "department": department,
        "location": location,
        "district": district,
        "city": city,
        "amount": number(amount),
        "amount_display": str(amount) if amount not in (None, "") else "Refer tender",
        "emd": number(emd),
        "fee": number(fee),
        "published_date": publish,
        "closing_date": close,
        "raw": x,
    }


def generate_payloads(cat_name):
    """Generate multiple payload format variants to ensure compatibility with KPPP search API."""
    return [
        {
            "tenderNumber": "",
            "category": cat_name.upper(),
            "status": "PUBLISHED",
            "deptId": None,
            "publishedFromDate": None,
            "publishedToDate": None,
            "tenderType": "OPEN",
            "title": "",
            "location": None,
            "tenderClosureFromDate": None,
            "tenderClosureToDate": None,
        },
        {
            "tenderNumber": "",
            "category": cat_name.capitalize(),
            "status": "PUBLISHED",
            "deptId": None,
            "publishedFromDate": None,
            "publishedToDate": None,
            "tenderType": "OPEN",
            "title": "",
            "location": None,
            "tenderClosureFromDate": None,
            "tenderClosureToDate": None,
        }
    ]


def fetch_all():
    s = requests.Session()
    all_rows, seen = [], set()

    for cat in CATEGORIES:
        print(f"--- Fetching Category: {cat} ---")
        cat_items_found = 0

        for payload_variant in generate_payloads(cat):
            if cat_items_found > 0:
                break # Already fetched items for this category

            for page in range(MAX_PAGES):
                try:
                    r = s.post(
                        SEARCH, 
                        params={"page": page, "size": PAGE_SIZE, "order-by-tender-publish": "true"}, 
                        json=payload_variant, 
                        headers=headers(), 
                        timeout=45
                    )
                    if r.status_code in (401, 403):
                        raise RuntimeError(f"KPPP authentication failed (HTTP {r.status_code}). Check GitHub secret KPPP_AUTH_TOKEN.")
                    r.raise_for_status()
                    
                    data = r.json()
                    items = find_list(data)
                    
                    if not items:
                        break

                    added_in_page = 0
                    for raw in items:
                        row = normalize(raw, cat)
                        key = row["id"] or row["ref_no"] or (row["title"], row["closing_date"])
                        if key in seen:
                            continue
                        seen.add(key)
                        all_rows.append(row)
                        added_in_page += 1

                    cat_items_found += added_in_page
                    print(f"Category {cat} | Page {page}: Found {len(items)} items ({added_in_page} new)")

                    if len(items) < PAGE_SIZE:
                        break
                    time.sleep(0.15)
                except Exception as err:
                    print(f"Error fetching page {page} for {cat}: {err}")
                    break

        print(f"Total unique tenders gathered for {cat}: {cat_items_found}")

    return all_rows


def main():
    rows = fetch_all()
    if not rows:
        raise RuntimeError("KPPP returned zero tenders. Existing public/tenders.json was NOT overwritten.")
    
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".tmp")
    temp.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SEARCH,
        "count": len(rows),
        "tenders": rows
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(OUT)
    print(f"Saved total {len(rows)} unique tenders to {OUT}")

if __name__ == "__main__":
    main()
