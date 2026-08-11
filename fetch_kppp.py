import json
import os
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests


BASE = "https://kppp.karnataka.gov.in"

SEARCH_URL = (
    BASE
    + "/supplier-registration-service/v1/api/portal-service/"
      "search-eproc-tenders"
)

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
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/124 Safari/537.36"
        ),
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


def number(value):
    if value in (None, ""):
        return None

    try:
        return float(
            str(value)
            .replace(",", "")
            .replace("₹", "")
            .strip()
        )
    except Exception:
        return None


def find_list(obj):
    if isinstance(obj, list):
        return obj

    if not isinstance(obj, dict):
        return []

    for key in (
        "content",
        "items",
        "results",
        "tenders",
        "records",
        "data",
    ):
        value = obj.get(key)

        if isinstance(value, list):
            return value

        if isinstance(value, dict):
            result = find_list(value)

            if result:
                return result

    for value in obj.values():
        if isinstance(value, dict):
            result = find_list(value)

            if result:
                return result

    return []


# =========================================================
# CATEGORY DETECTION
# =========================================================

WORK_KEYWORDS = [
    "construction",
    "constructing",
    "civil work",
    "civil works",
    "road work",
    "road works",
    "road improvement",
    "road construction",
    "road development",
    "asphalt",
    "bituminous road",
    "cc road",
    "cement concrete road",
    "building construction",
    "building work",
    "building works",
    "renovation",
    "repair work",
    "repair works",
    "maintenance work",
    "maintenance works",
    "development work",
    "development works",
    "improvement work",
    "improvement works",
    "drain construction",
    "storm water drain",
    "drain work",
    "culvert",
    "bridge work",
    "bridge construction",
    "pipeline work",
    "water supply work",
    "sewerage",
    "sewer line",
    "earth work",
    "earthwork",
    "excavation",
    "electrical work",
    "electrical works",
    "installation work",
    "plumbing work",
    "painting work",
    "roofing work",
    "compound wall",
    "retaining wall",
    "footpath",
    "pavement",
    "borewell",
    "check dam",
    "tank construction",
    "school building",
    "hospital building",
    "anganwadi building",
    "community hall",
    "construction of",
    "providing and laying",
    "providing & laying",
    "providing and fixing",
    "providing & fixing",
    "repairs to",
    "improvements to",
    "development of road",
    "formation of road",
    "widening of road",
    "resurfacing",
    "recarpeting",
    "white topping",
    "concreting",
]


SERVICE_KEYWORDS = [
    "consultancy",
    "consultant",
    "consulting service",
    "consulting services",
    "manpower",
    "man power",
    "outsourcing",
    "housekeeping",
    "security service",
    "security services",
    "cleaning service",
    "cleaning services",
    "maintenance service",
    "maintenance services",
    "annual maintenance contract",
    "annual maintenance services",
    "amc service",
    "operation and maintenance",
    "operation & maintenance",
    "o&m service",
    "data entry",
    "vehicle hiring",
    "hiring of vehicle",
    "hiring vehicles",
    "hire charges",
    "transport service",
    "transportation service",
    "insurance service",
    "audit service",
    "auditing",
    "survey service",
    "surveying service",
    "training service",
    "training programme",
    "event management",
    "canteen service",
    "catering service",
    "internet service",
    "software service",
    "software development",
    "technical support",
    "professional service",
    "professional services",
    "facility management",
    "facility management service",
    "printing service",
    "digitization",
    "scanning service",
    "testing service",
    "inspection service",
    "laboratory service",
    "third party inspection",
    "architectural consultancy",
    "project management consultancy",
    "pmc service",
    "recruitment service",
    "contract labour",
    "contract labor",
]


GOODS_KEYWORDS = [
    "supply of",
    "procurement of",
    "purchase of",
    "supply and installation",
    "supply & installation",
    "supply installation",
    "equipment",
    "furniture",
    "computer",
    "laptop",
    "desktop",
    "printer",
    "stationery",
    "medicine",
    "medicines",
    "drug",
    "drugs",
    "vehicle purchase",
    "machinery",
    "material supply",
    "supply materials",
    "supply of materials",
    "tyres",
    "tires",
    "uniform",
    "food items",
    "diet items",
    "electrical items",
    "medical equipment",
]


def infer_category(raw):
    api_category = str(
        pick(
            raw,
            "category",
            "tenderCategory",
            "categoryText",
            default=""
        )
    ).upper().strip()

    title = str(
        pick(
            raw,
            "title",
            "tenderTitle",
            "description",
            "workDescription",
            default=""
        )
    )

    description = str(
        pick(
            raw,
            "description",
            "tenderDescription",
            "workDescription",
            default=""
        )
    )

    text = f"{title} {description}".lower()

    work_score = sum(
        1 for keyword in WORK_KEYWORDS
        if keyword in text
    )

    service_score = sum(
        1 for keyword in SERVICE_KEYWORDS
        if keyword in text
    )

    goods_score = sum(
        1 for keyword in GOODS_KEYWORDS
        if keyword in text
    )

    # Strong service wording gets priority
    if service_score >= 1 and service_score >= work_score:
        return "SERVICES"

    # Strong construction/work wording
    if work_score >= 1:
        return "WORKS"

    # Trust API if it genuinely says WORKS/SERVICES
    if api_category in ("WORKS", "WORK"):
        return "WORKS"

    if api_category in ("SERVICES", "SERVICE"):
        return "SERVICES"

    if api_category in ("GOODS", "GOOD"):
        return "GOODS"

    if goods_score >= 1:
        return "GOODS"

    return "GOODS"


# =========================================================
# NORMALIZE DATA
# =========================================================

def normalize(raw):
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
            "tenderTitle",
            "title",
            "workDescription",
            "description",
            "tenderDescription",
            "name",
            default="Tender",
        )
    ).strip()

    # IMPORTANT: KPPP uses deptName
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

    published_date = str(
        pick(
            raw,
            "publishedDate",
            "publishDate",
            "dateOfPublication",
            "tenderPublishDate",
            default="",
        )
    )

    closing_date = str(
        pick(
            raw,
            "tenderClosureDate",
            "closingDate",
            "bidSubmissionEndDate",
            "submissionEndDate",
            "lastDate",
            "tenderEndDate",
            default="",
        )
    )

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

    category = infer_category(raw)

    return {
        "id": tender_id,
        "ref_no": ref_no,
        "title": title,
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


# =========================================================
# KPPP REQUEST
# =========================================================

def payload():
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
    }


def fetch_all():
    session = requests.Session()

    all_rows = []
    seen = set()

    for page in range(MAX_PAGES):

        print(f"Fetching KPPP page {page}...")

        response = session.post(
            SEARCH_URL,
            params={
                "page": page,
                "size": PAGE_SIZE,
                "order-by-tender-publish": "true",
            },
            json=payload(),
            headers=headers(),
            timeout=60,
        )

        print("HTTP:", response.status_code)

        if response.status_code in (401, 403):
            raise RuntimeError(
                "KPPP authentication failed. "
                "Check KPPP_AUTH_TOKEN GitHub secret."
            )

        response.raise_for_status()

        try:
            data = response.json()

        except Exception:
            print(response.text[:1000])

            raise RuntimeError(
                "KPPP returned invalid JSON."
            )

        items = find_list(data)

        print(
            f"Page {page}: "
            f"{len(items)} tenders returned"
        )

        if not items:
            break

        for raw in items:

            row = normalize(raw)

            key = (
                row["id"]
                or row["ref_no"]
                or (
                    row["title"],
                    row["closing_date"]
                )
            )

            if key in seen:
                continue

            seen.add(key)

            all_rows.append(row)

        if len(items) < PAGE_SIZE:
            break

        time.sleep(0.20)

    return all_rows


def main():

    print("=" * 60)
    print("KPPP TENDER COLLECTOR")
    print("=" * 60)

    rows = fetch_all()

    if not rows:
        raise RuntimeError(
            "KPPP returned ZERO tenders. "
            "Existing tenders.json NOT overwritten."
        )

    category_counts = Counter(
        row["category"]
        for row in rows
    )

    print()
    print("=" * 60)
    print("CATEGORY COUNTS")
    print("=" * 60)

    print(
        json.dumps(
            dict(category_counts),
            indent=2
        )
    )

    print()
    print("TOTAL:", len(rows))

    works = category_counts.get("WORKS", 0)
    goods = category_counts.get("GOODS", 0)
    services = category_counts.get("SERVICES", 0)

    print(f"WORKS    : {works}")
    print(f"GOODS    : {goods}")
    print(f"SERVICES : {services}")

    OUT.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    temp = OUT.with_suffix(".tmp")

    output_data = {
        "generated_at": datetime.now(
            timezone.utc
        ).isoformat(),

        "source": SEARCH_URL,

        "count": len(rows),

        "category_counts": {
            "WORKS": works,
            "GOODS": goods,
            "SERVICES": services,
        },

        "tenders": rows,
    }

    temp.write_text(
        json.dumps(
            output_data,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    temp.replace(OUT)

    print()
    print(
        f"SUCCESS: Saved {len(rows)} tenders "
        f"to {OUT}"
    )


if __name__ == "__main__":
    main()
