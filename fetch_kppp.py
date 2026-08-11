import json
import os
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE = "https://kppp.karnataka.gov.in"
SEARCH = BASE + "/supplier-registration-service/v1/api/portal-service/search-eproc-tenders"
OUT = Path("public/tenders.json")
TOKEN = os.getenv("KPPP_AUTH_TOKEN", "").strip()
PAGE_SIZE = int(os.getenv("KPPP_PAGE_SIZE", "100"))
MAX_PAGES = int(os.getenv("KPPP_MAX_PAGES", "250"))


def headers():
    h = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": BASE,
        "Referer": BASE + "/",
        "Post": "CONTRACTOR-EPROC-CONTRACTOR",
        "User-Agent": "Mozilla/5.0 KPPP-Tender-Aggregator/2.0",
    }
    if TOKEN:
        h["Authorization"] = "Bearer " + TOKEN
    return h


def pick(d, *keys, default=""):
    if not isinstance(d, dict):
        return default
    for key in keys:
        value = d.get(key)
        if value not in (None, ""):
            return value
    return default


def find_list(obj):
    if isinstance(obj, list):
        return obj
    if not isinstance(obj, dict):
        return []
    for key in ("content", "items", "results", "tenders", "records", "data"):
        value = obj.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            nested = find_list(value)
            if nested:
                return nested
    return []


def number(value):
    try:
        if value in (None, ""):
            return None
        return float(str(value).replace(",", "").replace("₹", "").strip())
    except Exception:
        return None


def normalize_category(value):
    text = str(value or "").strip().upper()
    if text.startswith("WORK"):
        return "WORKS"
    if text.startswith("SERVICE"):
        return "SERVICES"
    if text.startswith("GOOD"):
        return "GOODS"
    return text or "UNKNOWN"


def normalize(raw):
    tid = str(pick(raw, "id", "tenderId", "tenderID", "tenderPk", "tenderNumber", "tenderNo", default="")).strip()
    ref = str(pick(raw, "tenderNumber", "tenderNo", "tenderReferenceNumber", "referenceNumber", "nitNumber", default=tid)).strip()
    title = str(pick(raw, "tenderTitle", "title", "workDescription", "description", "tenderDescription", "name", default="Tender"))

    # KPPP currently exposes these short field names in the public search result.
    amount_raw = pick(
        raw,
        "ecv",
        "estimatedContractValue",
        "estimatedAmount",
        "estimatedTenderValue",
        "tenderValue",
        "estimatedCost",
        "provisionalAmount",
        "amount",
        default="",
    )

    category_raw = pick(raw, "category", "tenderCategory", "categoryText", default="")
    category = normalize_category(category_raw)

    department = str(
        pick(
            raw,
            "deptName",
            "departmentName",
            "department",
            "departmentNameEn",
            "organisationName",
            "organisation",
            "organization",
            "procuringEntity",
            default="Karnataka Government",
        )
    )

    location = str(pick(raw, "locationName", "location", "districtName", "district", "placeOfWork", default="Karnataka"))
    district = str(pick(raw, "districtName", "district", "district_name", default=""))
    city = str(pick(raw, "cityName", "city", "townName", "town", "talukName", "taluk", default=""))
    close = str(pick(raw, "tenderClosureDate", "closingDate", "bidSubmissionEndDate", "submissionEndDate", "lastDate", "tenderEndDate", default=""))
    publish = str(pick(raw, "publishedDate", "publishDate", "dateOfPublication", "tenderPublishDate", default=""))
    emd = pick(raw, "emdAmount", "emd", "emdValue", default="")
    fee = pick(raw, "tenderFee", "tenderFeeAmount", "fee", default="")

    return {
        "id": tid,
        "ref_no": ref,
        "title": title,
        "category": category,
        "department": department,
        "location": location,
        "district": district,
        "city": city,
        "amount": number(amount_raw),
        "amount_display": str(amount_raw) if amount_raw not in (None, "") else "Refer tender",
        "emd": number(emd),
        "fee": number(fee),
        "published_date": publish,
        "closing_date": close,
        "raw": raw,
    }


def base_payload():
    # IMPORTANT: do not force GOODS/WORKS/SERVICES here.
    # The KPPP public search can return the full live list; we categorize locally
    # from each row's own category/categoryText field.
    return {
        "tenderNumber": "",
        "status": "PUBLISHED",
        "deptId": None,
        "publishedFromDate": None,
        "publishedToDate": None,
        "tenderType": "OPEN",
        "title": "",
        "location": None,
        "tenderClosureFromDate": None,
        "tenderClosureToDate": None,
        "category": None,
    }


def fetch_all():
    session = requests.Session()
    rows = []
    seen = set()

    for page in range(MAX_PAGES):
        response = session.post(
            SEARCH,
            params={"page": page, "size": PAGE_SIZE, "order-by-tender-publish": "true"},
            json=base_payload(),
            headers=headers(),
            timeout=45,
        )

        if response.status_code in (401, 403):
            raise RuntimeError(
                f"KPPP authentication failed (HTTP {response.status_code}). "
                "Add/refresh the GitHub secret KPPP_AUTH_TOKEN."
            )

        response.raise_for_status()
        data = response.json()
        items = find_list(data)
        print(f"ALL CATEGORIES page {page}: {len(items)}")

        if not items:
            break

        for raw in items:
            row = normalize(raw)
            key = row["id"] or row["ref_no"] or (row["title"], row["closing_date"])
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)

        if len(items) < PAGE_SIZE:
            break
        time.sleep(0.15)

    return rows


def main():
    rows = fetch_all()
    if not rows:
        raise RuntimeError("KPPP returned zero tenders. Existing public/tenders.json was NOT overwritten.")

    category_counts = Counter(row["category"] for row in rows)
    print("CATEGORY COUNTS:", dict(category_counts))

    # Do not silently replace the good database with another one-category result.
    visible_categories = {c for c in ("WORKS", "GOODS", "SERVICES") if category_counts.get(c, 0) > 0}
    if len(visible_categories) < 2:
        raise RuntimeError(
            "KPPP result still contains fewer than two of WORKS/GOODS/SERVICES: "
            f"{dict(category_counts)}. Refusing to overwrite public/tenders.json."
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".tmp")
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SEARCH,
        "count": len(rows),
        "category_counts": dict(category_counts),
        "tenders": rows,
    }
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(OUT)
    print(f"Saved {len(rows)} unique tenders to {OUT}")


if __name__ == "__main__":
    main()
