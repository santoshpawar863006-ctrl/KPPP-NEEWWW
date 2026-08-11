import json
import os
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests


# ============================================================
# KPPP CONFIG
# ============================================================

BASE = "https://kppp.karnataka.gov.in"

BASE_API = (
    BASE
    + "/supplier-registration-service/v1/api"
)

OUT = Path("public/tenders.json")

PAGE_SIZE = int(
    os.getenv("KPPP_PAGE_SIZE", "100")
)

MAX_PAGES = int(
    os.getenv("KPPP_MAX_PAGES", "250")
)

TOKEN = os.getenv(
    "KPPP_AUTH_TOKEN",
    ""
).strip()


# ============================================================
# IMPORTANT:
# KPPP HAS DIFFERENT ENDPOINTS FOR EACH CATEGORY
# ============================================================

CATEGORY_ENDPOINTS = {

    "WORKS": (
        BASE_API
        + "/portal-service/works/search-eproc-tenders"
    ),

    "GOODS": (
        BASE_API
        + "/portal-service/search-eproc-tenders"
    ),

    "SERVICES": (
        BASE_API
        + "/portal-service/services/search-eproc-tenders"
    ),
}


# ============================================================
# REQUEST HEADERS
# ============================================================

def headers():

    h = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": BASE,
        "Referer": BASE + "/",
        "User-Agent": (
            "Mozilla/5.0 "
            "(Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 "
            "Chrome/124 Safari/537.36"
        ),
    }

    # Token is optional for public portal search.
    if TOKEN:
        h["Authorization"] = "Bearer " + TOKEN

    return h


# ============================================================
# HELPERS
# ============================================================

def pick(data, *keys, default=""):

    if not isinstance(data, dict):
        return default

    for key in keys:

        value = data.get(key)

        if value not in (None, ""):
            return value

    return default


def number(value):

    if value in (None, ""):
        return None

    try:

        cleaned = (
            str(value)
            .replace(",", "")
            .replace("₹", "")
            .strip()
        )

        return float(cleaned)

    except Exception:
        return None


def find_list(data):

    # KPPP normally returns a list directly.
    if isinstance(data, list):
        return data

    if not isinstance(data, dict):
        return []

    for key in (
        "content",
        "items",
        "results",
        "tenders",
        "records",
        "data",
    ):

        value = data.get(key)

        if isinstance(value, list):
            return value

        if isinstance(value, dict):

            nested = find_list(value)

            if nested:
                return nested

    return []


# ============================================================
# NORMALIZE TENDER
# ============================================================

def normalize(raw, category):

    tender_id = str(
        pick(
            raw,
            "id",
            "tenderId",
            "tenderID",
            "tenderPk",
            "tenderNumber",
            default=""
        )
    ).strip()

    ref_no = str(
        pick(
            raw,
            "tenderNumber",
            "tenderNo",
            "tenderReferenceNumber",
            "referenceNumber",
            "nitNumber",
            default=tender_id,
        )
    ).strip()

    title = str(
        pick(
            raw,
            "title",
            "tenderTitle",
            "description",
            "workDescription",
            "tenderDescription",
            default="Tender",
        )
    ).strip()

    # KPPP actual field is deptName
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
    ).strip()

    location = str(
        pick(
            raw,
            "locationName",
            "location",
            "districtName",
            "district",
            "placeOfWork",
            default="Karnataka",
        )
    ).strip()

    district = str(
        pick(
            raw,
            "districtName",
            "district",
            default=""
        )
    ).strip()

    city = str(
        pick(
            raw,
            "cityName",
            "city",
            "townName",
            "town",
            "talukName",
            "taluk",
            default=""
        )
    ).strip()

    # KPPP uses ecv
    amount_raw = pick(
        raw,
        "ecv",
        "estimatedContractValue",
        "estimatedAmount",
        "estimatedTenderValue",
        "tenderValue",
        "estimatedCost",
        "amount",
        default=""
    )

    published_date = str(
        pick(
            raw,
            "publishedDate",
            "publishDate",
            "dateOfPublication",
            "tenderPublishDate",
            default=""
        )
    ).strip()

    closing_date = str(
        pick(
            raw,
            "tenderClosureDate",
            "closingDate",
            "bidSubmissionEndDate",
            "submissionEndDate",
            "lastDate",
            default=""
        )
    ).strip()

    emd_raw = pick(
        raw,
        "emdAmount",
        "emd",
        "emdValue",
        default=""
    )

    fee_raw = pick(
        raw,
        "tenderFee",
        "tenderFeeAmount",
        "fee",
        default=""
    )

    return {

        "id": tender_id,

        "ref_no": ref_no,

        "title": title,

        # IMPORTANT:
        # CATEGORY COMES FROM ENDPOINT,
        # NOT FROM RAW RESPONSE.
        "category": category,

        "department": department,

        "location": location,

        "district": district,

        "city": city,

        "amount": number(amount_raw),

        "amount_display": (
            str(amount_raw)
            if amount_raw not in (None, "")
            else "Refer tender"
        ),

        "emd": number(emd_raw),

        "fee": number(fee_raw),

        "published_date": published_date,

        "closing_date": closing_date,

        "raw": raw,
    }


# ============================================================
# PAYLOAD
# ============================================================

def payload(category):

    # Minimal payload known to work with KPPP portal.
    return {
        "category": category,
        "status": "ALL",
        "title": ""
    }


# ============================================================
# FETCH ONE CATEGORY
# ============================================================

def fetch_category(session, category, url):

    print()
    print("=" * 60)
    print("FETCHING:", category)
    print("URL:", url)
    print("=" * 60)

    rows = []

    seen = set()

    for page in range(MAX_PAGES):

        print(
            f"{category} page {page}..."
        )

        response = session.post(

            url,

            params={
                "page": page,
                "size": PAGE_SIZE,
                "order-by-tender-publish": "true",
            },

            json=payload(category),

            headers=headers(),

            timeout=60,
        )

        print(
            f"{category} page {page} "
            f"HTTP {response.status_code}"
        )

        if response.status_code != 200:

            print()
            print("KPPP RESPONSE:")
            print(
                response.text[:2000]
            )

            raise RuntimeError(
                f"KPPP {category} request failed "
                f"with HTTP {response.status_code}"
            )

        try:

            data = response.json()

        except Exception:

            print(
                response.text[:2000]
            )

            raise RuntimeError(
                f"KPPP returned invalid JSON "
                f"for {category}"
            )

        items = find_list(data)

        print(
            f"{category}: "
            f"{len(items)} tenders on page {page}"
        )

        if not items:
            break

        for raw in items:

            tender = normalize(
                raw,
                category
            )

            key = (
                tender["id"]
                or tender["ref_no"]
                or (
                    tender["title"],
                    tender["closing_date"],
                )
            )

            if key in seen:
                continue

            seen.add(key)

            rows.append(tender)

        # Last page
        if len(items) < PAGE_SIZE:
            break

        time.sleep(0.25)

    print()
    print(
        f"{category} TOTAL FETCHED: "
        f"{len(rows)}"
    )

    return rows


# ============================================================
# FETCH ALL
# ============================================================

def fetch_all():

    session = requests.Session()

    all_rows = []

    global_seen = set()

    for category, url in CATEGORY_ENDPOINTS.items():

        category_rows = fetch_category(
            session,
            category,
            url
        )

        for tender in category_rows:

            key = (
                tender["id"]
                or tender["ref_no"]
                or (
                    tender["title"],
                    tender["closing_date"],
                )
            )

            if key in global_seen:
                continue

            global_seen.add(key)

            all_rows.append(tender)

    return all_rows


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("=" * 60)
    print("KPPP KARNATAKA TENDER COLLECTOR")
    print("WORKS + GOODS + SERVICES")
    print("=" * 60)

    rows = fetch_all()

    if not rows:

        raise RuntimeError(
            "KPPP returned ZERO tenders. "
            "tenders.json was NOT overwritten."
        )

    counts = Counter(
        tender["category"]
        for tender in rows
    )

    works = counts.get(
        "WORKS",
        0
    )

    goods = counts.get(
        "GOODS",
        0
    )

    services = counts.get(
        "SERVICES",
        0
    )

    print()
    print("=" * 60)
    print("FINAL KPPP RESULTS")
    print("=" * 60)

    print(
        "TOTAL:",
        len(rows)
    )

    print(
        "WORKS:",
        works
    )

    print(
        "GOODS:",
        goods
    )

    print(
        "SERVICES:",
        services
    )

    # Safety check
    if works == 0:

        raise RuntimeError(
            "WORKS endpoint returned zero tenders. "
            "Database NOT overwritten."
        )

    if goods == 0:

        raise RuntimeError(
            "GOODS endpoint returned zero tenders. "
            "Database NOT overwritten."
        )

    if services == 0:

        raise RuntimeError(
            "SERVICES endpoint returned zero tenders. "
            "Database NOT overwritten."
        )

    output = {

        "generated_at": (
            datetime.now(
                timezone.utc
            ).isoformat()
        ),

        "source": BASE,

        "count": len(rows),

        "category_counts": {

            "WORKS": works,

            "GOODS": goods,

            "SERVICES": services,
        },

        "tenders": rows,
    }

    OUT.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    temp = OUT.with_suffix(
        ".tmp"
    )

    temp.write_text(

        json.dumps(
            output,
            ensure_ascii=False,
            indent=2
        ),

        encoding="utf-8"
    )

    temp.replace(OUT)

    print()
    print("=" * 60)

    print(
        "SUCCESS:",
        len(rows),
        "tenders saved"
    )

    print(
        "WORKS:",
        works
    )

    print(
        "GOODS:",
        goods
    )

    print(
        "SERVICES:",
        services
    )

    print(
        "FILE:",
        OUT
    )

    print("=" * 60)


if __name__ == "__main__":

    main()
