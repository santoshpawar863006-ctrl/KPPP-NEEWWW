import requests

BASE = "https://tenderkart.in"
REF = "KNNL/2025-26/IW/WORK_INDENT4114/CALL-2"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": BASE + "/tenders/filters"}


def shape(value, depth=0):
    if depth > 2:
        return type(value).__name__
    if isinstance(value, dict):
        out = {}
        for k, v in list(value.items())[:30]:
            if isinstance(v, (dict, list)):
                out[k] = shape(v, depth + 1)
            else:
                s = str(v)
                out[k] = s[:180]
        return out
    if isinstance(value, list):
        return [shape(x, depth + 1) for x in value[:3]]
    return str(value)[:180]


def request_json(session, method, url, **kwargs):
    try:
        r = session.request(method, url, timeout=10, allow_redirects=True, **kwargs)
        item = {"http": r.status_code, "url": r.url, "content_type": r.headers.get("content-type", "")}
        try:
            data = r.json()
            item["json"] = shape(data)
        except Exception:
            item["text"] = (r.text or "")[:500]
        return item
    except Exception as exc:
        return {"error": str(exc)[:200]}


def run_probe():
    s = requests.Session()
    attempts = []

    for params in (
        {"keywords": REF, "limit": "10"},
        {"keyword": REF, "limit": "10"},
        {"q": REF, "limit": "10"},
        {"keywords": REF, "state": "Karnataka", "limit": "10"},
        {"keyword": REF, "state": "Karnataka", "limit": "10"},
    ):
        result = request_json(s, "GET", BASE + "/api/v1/tenders", headers=HEADERS, params=params)
        result["params"] = params
        attempts.append(result)

    parsed = request_json(
        s,
        "POST",
        BASE + "/api/v1/parse-query",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"query": REF},
    )

    page = request_json(s, "GET", BASE + "/tenders/filters", headers={"User-Agent": UA}, params={"keyword": REF})

    return {"success": True, "ref": REF, "tender_api_attempts": attempts, "parse_query": parsed, "filter_page": page}
