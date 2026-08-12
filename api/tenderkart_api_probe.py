import requests

BASE = "https://tenderkart.in"
REF = "KNNL/2025-26/IW/WORK_INDENT4114/CALL-2"
UUID = "3e3f8ef6-7303-41f6-92fc-4cb8501048f5"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": BASE + "/tenders/filters"}


def shape(value, depth=0):
    if depth > 4:
        return type(value).__name__
    if isinstance(value, dict):
        out = {}
        for k, v in list(value.items())[:80]:
            if isinstance(v, (dict, list)):
                out[k] = shape(v, depth + 1)
            else:
                s = str(v)
                out[k] = s[:500]
        return out
    if isinstance(value, list):
        return [shape(x, depth + 1) for x in value[:8]]
    return str(value)[:500]


def request_json(session, method, url, **kwargs):
    try:
        r = session.request(method, url, timeout=12, allow_redirects=True, **kwargs)
        item = {"http": r.status_code, "url": r.url, "content_type": r.headers.get("content-type", "")}
        try:
            data = r.json()
            item["json"] = shape(data)
        except Exception:
            item["text"] = (r.text or "")[:1000]
        return item
    except Exception as exc:
        return {"error": str(exc)[:240]}


def run_probe():
    s = requests.Session()
    search = request_json(
        s,
        "GET",
        BASE + "/api/v1/tenders",
        headers=HEADERS,
        params={"keywords": REF, "state": "Karnataka", "limit": "10"},
    )
    detail = request_json(s, "GET", BASE + "/api/v1/tenders/" + UUID, headers=HEADERS)
    public_page = request_json(s, "GET", BASE + "/tender/" + UUID, headers={"User-Agent": UA})
    return {"success": True, "ref": REF, "search": search, "detail": detail, "public_page": public_page}
