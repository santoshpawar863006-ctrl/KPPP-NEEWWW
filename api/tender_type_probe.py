import requests

BASE = "https://kppp.karnataka.gov.in/supplier-registration-service/v1/api/portal-service/works/search-eproc-tenders"

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://kppp.karnataka.gov.in",
    "Referer": "https://kppp.karnataka.gov.in/",
    "Post": "CONTRACTOR-EPROC-CONTRACTOR",
    "User-Agent": "Mozilla/5.0 Chrome/124 Safari/537.36",
}

CANDIDATES = [
    None,
    "OPEN",
    "RESERVED",
    "PREQUALIFIED",
    "PRE_QUALIFIED",
    "PREQUALIFICATION",
    "PRE_QUALIFICATION",
    "PREQUALIFY",
    "QUALIFIED",
    "LIMITED",
    "RESTRICTED",
]


def run_probe():
    out = []
    for tender_type in CANDIDATES:
        payload = {"category": "WORKS", "status": "PUBLISHED", "title": ""}
        if tender_type is not None:
            payload["tenderType"] = tender_type
        try:
            r = requests.post(
                BASE,
                params={"page": 0, "size": 1, "order-by-tender-publish": "true"},
                json=payload,
                headers=HEADERS,
                timeout=20,
            )
            entry = {
                "candidate": tender_type,
                "http": r.status_code,
                "x_total_count": r.headers.get("X-Total-Count") or r.headers.get("x-total-count"),
            }
            try:
                data = r.json()
                if r.status_code != 200:
                    entry["error_json"] = data
                    out.append(entry)
                    continue
                if isinstance(data, list):
                    rows = data
                elif isinstance(data, dict):
                    rows = data.get("content") or data.get("items") or data.get("data") or []
                    if isinstance(rows, dict):
                        rows = rows.get("content") or []
                else:
                    rows = []
                entry["returned"] = len(rows) if isinstance(rows, list) else 0
                if isinstance(rows, list) and rows:
                    row = rows[0]
                    entry["sample"] = {
                        "id": row.get("id"),
                        "tenderNumber": row.get("tenderNumber"),
                        "tenderType": row.get("tenderType"),
                        "tenderTypeText": row.get("tenderTypeText"),
                        "invitingStrategy": row.get("invitingStrategy"),
                        "invitingStrategyText": row.get("invitingStrategyText"),
                        "procEntityType": row.get("procEntityType"),
                        "procEntityTypeText": row.get("procEntityTypeText"),
                    }
            except Exception:
                entry["body"] = r.text[:800]
            out.append(entry)
        except Exception as exc:
            out.append({"candidate": tender_type, "error": str(exc)[:200]})
    return {"success": True, "results": out}
