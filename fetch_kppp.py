import json, os, time
from datetime import datetime, timezone
from pathlib import Path
import requests

BASE = "https://kppp.karnataka.gov.in"
SEARCH = BASE + "/supplier-registration-service/v1/api/portal-service/search-eproc-tenders"
DEPARTMENTS = BASE + "/supplier-registration-service/v1/api/portal-service/departments/activeDepartment"
CURRENT_TIME = BASE + "/supplier-registration-service/v1/api/portal-service/get-current-time"
OUT = Path("public/tenders.json")
TOKEN = os.getenv("KPPP_AUTH_TOKEN", "").strip()
PAGE_SIZE = int(os.getenv("KPPP_PAGE_SIZE", "100"))
MAX_PAGES = int(os.getenv("KPPP_MAX_PAGES", "250"))
CATEGORIES = [x.strip().upper() for x in os.getenv("KPPP_CATEGORIES", "WORKS,GOODS,SERVICES").split(",") if x.strip()]


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
        if isinstance(v, list): return v
        if isinstance(v, dict):
            nested = find_list(v)
            if nested: return nested
    return []


def number(v):
    try:
        return float(str(v).replace(",", "").replace("₹", "").strip())
    except Exception:
        return None


def normalize(x, category):
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

    # Force category casing to UPPERCASE for exact UI matching
    raw_cat = str(pick(x, "category", "tenderCategory", default=category)).strip().upper()

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


def payload(category):
    return {
        "tenderNumber": "",
        "category": category,
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


def fetch_all():
    s = requests.Session()
    all_rows, seen = [], set()
    for cat in CATEGORIES:
        print(f"--- {cat} ---")
        for page in range(MAX_PAGES):
            r = s.post(SEARCH, params={"page": page, "size": PAGE_SIZE, "order-by-tender-publish": "true"}, json=payload(cat), headers=headers(), timeout=45)
            if r.status_code in (401, 403):
                raise RuntimeError(f"KPPP authentication failed (HTTP {r.status_code}). Add/refresh the GitHub secret KPPP_AUTH_TOKEN.")
            r.raise_for_status()
            data = r.json()
            items = find_list(data)
            print(f"{cat} page {page}: {len(items)}")
            if not items: break
            for raw in items:
                row = normalize(raw, cat)
                key = row["id"] or row["ref_no"] or (row["title"], row["closing_date"])
                if key in seen: continue
                seen.add(key); all_rows.append(row)
            if len(items) < PAGE_SIZE: break
            time.sleep(0.15)
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
    print(f"Saved {len(rows)} unique tenders to {OUT}")

if __name__ == "__main__":
    main()
