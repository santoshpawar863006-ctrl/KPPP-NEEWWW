import html
import re
from urllib.parse import urlparse, unquote

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}

MIRROR_HOSTS = {"s3.nl.geostorage.net"}


def clean_text(raw_html):
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw_html or "", flags=re.I | re.S)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def norm(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def host_of(url):
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def is_official(host):
    return (
        host == "kppp.karnataka.gov.in"
        or host.endswith(".karnataka.gov.in")
        or host == "karnataka.gov.in"
        or host.endswith(".kar.nic.in")
        or host.endswith(".gov.in")
        or host == "gov.in"
    )


def allowed_host(host):
    return is_official(host) or host in MIRROR_HOSTS


def add_result(results, url, title=""):
    url = html.unescape(str(url or "")).strip()
    if "uddg=" in url:
        m = re.search(r"[?&]uddg=([^&]+)", url)
        if m:
            url = unquote(m.group(1))
    if url.startswith("//"):
        url = "https:" + url
    if not url.startswith("http"):
        return
    host = host_of(url)
    if not allowed_host(host):
        return
    if any(x in url.lower() for x in ("bing.com", "google.com", "duckduckgo.com")):
        return
    if any(x["url"] == url for x in results):
        return
    results.append({"url": url, "title": clean_text(title)[:180], "host": host, "official": is_official(host)})


def bing_search(session, query):
    try:
        r = session.get(
            "https://www.bing.com/search",
            params={"q": query, "count": "10", "setlang": "en-IN"},
            headers={**HEADERS, "Referer": "https://www.bing.com/"},
            timeout=7,
        )
    except Exception:
        return []
    if r.status_code != 200:
        return []

    results = []
    for block in re.findall(r'<li[^>]*class=["\'][^"\']*b_algo[^"\']*["\'][\s\S]*?</li>', r.text, flags=re.I):
        m = re.search(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', block, flags=re.I)
        if m:
            add_result(results, m.group(1), m.group(2))
        if len(results) >= 8:
            break
    return results


def ddg_search(session, query):
    try:
        r = session.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers=HEADERS,
            timeout=7,
        )
    except Exception:
        return []
    if r.status_code != 200:
        return []

    results = []
    for block in re.findall(r'<div[^>]*class=["\'][^"\']*result[^"\']*["\'][\s\S]*?</div>\s*</div>', r.text, flags=re.I):
        m = re.search(r'<a[^>]+class=["\'][^"\']*result__a[^"\']*["\'][^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', block, flags=re.I)
        if m:
            add_result(results, m.group(1), m.group(2))
        if len(results) >= 8:
            break

    if not results:
        for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', r.text, flags=re.I):
            add_result(results, m.group(1), m.group(2))
            if len(results) >= 8:
                break
    return results


def search_public(session, query):
    out = bing_search(session, query)
    if out:
        return out
    return ddg_search(session, query)


def money_near(text, keyword):
    pattern = rf"{keyword}.{{0,180}}?(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(crore|crores|cr|lakh|lakhs|lac|lacs)?"
    m = re.search(pattern, text, flags=re.I)
    if not m:
        return None
    try:
        value = float(m.group(1).replace(",", ""))
    except Exception:
        return None
    unit = (m.group(2) or "").lower()
    if unit in {"crore", "crores", "cr"}:
        value *= 10000000
    elif unit in {"lakh", "lakhs", "lac", "lacs"}:
        value *= 100000
    return value if value > 0 else None


def extract_signals(text):
    low = text.lower()
    signals = {}
    tags = []

    if re.search(r"reserved\s+under\s+(?:sc|scheduled caste)|only contractor belongs to scheduled caste|scheduled caste.*should participate", low, flags=re.I):
        signals["reservation"] = "SC"
        tags.append("SC reservation condition found")
    elif re.search(r"reserved\s+under\s+(?:st|scheduled tribe)|only contractor belongs to scheduled tribe|scheduled tribe.*should participate", low, flags=re.I):
        signals["reservation"] = "ST"
        tags.append("ST reservation condition found")
    elif "reserved category" in low:
        signals["reservation"] = "Reserved category"
        tags.append("Reserved-category condition found")

    class_match = re.search(r"kpwd\s+class\s*[-:]?\s*([ivx0-9]+(?:\s*(?:or|and)\s*above)?)", text, flags=re.I)
    if class_match:
        signals["kpwd_class"] = class_match.group(1).strip()
        tags.append("KPWD class requirement found")
    elif "kpwd registration" in low or "kpwd registered" in low:
        tags.append("KPWD registration requirement found")

    capacity = money_near(text, r"(?:available\s+)?tender\s+capacity")
    if capacity:
        signals["minimum_tender_capacity"] = capacity
        tags.append("Tender-capacity criterion found")

    turnover = money_near(text, r"(?:minimum\s+)?financial\s+turnover")
    if turnover:
        signals["minimum_financial_turnover"] = turnover
        tags.append("Financial-turnover criterion found")

    validity = re.search(r"bid\s+validity.{0,80}?([0-9]{1,4})\s*days?", text, flags=re.I)
    if validity:
        signals["bid_validity_days"] = int(validity.group(1))
        tags.append("Bid-validity period found")

    if "pan card" in low or "pan and gst" in low or "gst no" in low:
        tags.append("PAN/GST document requirement found")
    if "technical bid" in low:
        tags.append("Technical-bid criteria found")

    signals["tags"] = tags[:8]
    return signals


def fetch_verified(session, tender_ref, item):
    try:
        r = session.get(item["url"], headers=HEADERS, timeout=7, allow_redirects=True)
    except Exception:
        return None
    if r.status_code != 200:
        return None
    text = clean_text(r.text)
    if norm(tender_ref) not in norm(text):
        return None
    host = host_of(r.url)
    if not allowed_host(host):
        return None
    return {
        "title": item.get("title") or host,
        "url": r.url,
        "host": host,
        "official": is_official(host),
        "signals": extract_signals(text),
    }


def lookup_public_details(tender_ref):
    tender_ref = str(tender_ref or "").strip()
    if not tender_ref:
        return {"success": False, "message": "Tender number is required."}

    session = requests.Session()
    queries = [
        f'"{tender_ref}" site:karnataka.gov.in',
        f'"{tender_ref}" site:gov.in Karnataka tender',
        f'"{tender_ref}" site:s3.nl.geostorage.net',
        f'"{tender_ref}" KPPP tender document',
    ]

    candidates = []
    for query in queries:
        for item in search_public(session, query):
            if not any(x["url"] == item["url"] for x in candidates):
                candidates.append(item)
        if len(candidates) >= 8:
            break

    candidates.sort(key=lambda x: (not x.get("official", False), x.get("host", "")))

    sources = []
    for item in candidates[:8]:
        verified = fetch_verified(session, tender_ref, item)
        if verified:
            sources.append(verified)
        if len(sources) >= 4:
            break

    return {
        "success": True,
        "tender_ref": tender_ref,
        "sources": sources,
        "source_count": len(sources),
        "note": "KPPP remains the primary source. Public web sources are enrichment only and do not overwrite core KPPP fields.",
    }
