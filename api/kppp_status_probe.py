import requests

BASE = "https://kppp.karnataka.gov.in"
API = BASE + "/supplier-registration-service/v1/api"

ENDPOINTS = {
    "WORKS": API + "/portal-service/works/search-eproc-tenders",
    "GOODS": API + "/portal-service/search-eproc-tenders",
    "SERVICES": API + "/portal-service/services/search-eproc-tenders",
}


def headers():
    return {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": BASE,
        "Referer": BASE + "/",
        "Post": "CONTRACTOR-EPROC-CONTRACTOR",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    }


def find_rows(data):
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("content", "items", "results", "tenders", "records", "data"):
        value = data.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            nested = find_rows(value)
            if nested:
                return nested
    return []


def total_from(response, data, rows):
    for key in ("x-total-count", "X-Total-Count", "total-count", "total"):
        value = response.headers.get(key)
        if value not in (None, ""):
            try:
                return int(value)
            except Exception:
                return value
    if isinstance(data, dict):
        for key in ("totalElements", "total", "totalCount", "count"):
            value = data.get(key)
            if value not in (None, ""):
                try:
                    return int(value)
                except Exception:
                    return value
    return len(rows)


def one_request(session, category, url, mode):
    body = {"category": category, "title": ""}
    if mode == "published":
        body["status"] = "PUBLISHED"
    elif mode == "blank":
        body["status"] = ""

    r = session.post(
        url,
        params={"page": 0, "size": 100, "order-by-tender-publish": "true"},
        json=body,
        headers=headers(),
        timeout=20,
    )
    try:
        data = r.json()
    except Exception:
        data = None
    rows = find_rows(data)
    statuses = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or row.get("statusText") or "<blank>").strip() or "<blank>"
        statuses[status] = statuses.get(status, 0) + 1
    return {
        "http": r.status_code,
        "total": total_from(r, data, rows),
        "sample_rows": len(rows),
        "sample_statuses": statuses,
        "response_type": type(data).__name__ if data is not None else "non-json",
    }


def probe():
    out = {"success": True, "categories": {}}
    with requests.Session() as session:
        for category, url in ENDPOINTS.items():
            result = {}
            for mode in ("published", "omitted", "blank"):
                try:
                    result[mode] = one_request(session, category, url, mode)
                except Exception as exc:
                    result[mode] = {"error": str(exc)[:200]}
            out["categories"][category] = result
    return out
