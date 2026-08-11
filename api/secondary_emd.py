from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode, unquote
import html
import json
import re
import requests


SEARCH_URLS = [
    ("BidAssist", "bidassist.com"),
    ("TenderDetail", "tenderdetail.com"),
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}


def clean_text(raw_html):
    if not raw_html:
        return ""
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw_html, flags=re.I | re.S)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def normalise_ref(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def parse_money(value):
    if value is None:
        return None
    try:
        n = float(str(value).replace(",", "").strip())
        return n if n > 0 else None
    except Exception:
        return None


def extract_emd(text):
    if not text:
        return None

    patterns = [
        r"\bEMD\b\s*(?:Amount)?\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9][0-9,]*(?:\.\d+)?)",
        r"Earnest\s+Money\s+Deposit\s*(?:Amount)?\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9][0-9,]*(?:\.\d+)?)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            value = parse_money(match.group(1))
            if value:
                return value
    return None


def extract_fee(text):
    if not text:
        return None

    patterns = [
        r"Tender\s+Fee\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9][0-9,]*(?:\.\d+)?)",
        r"Document\s+(?:Cost|Fees?)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9][0-9,]*(?:\.\d+)?)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            value = parse_money(match.group(1))
            if value:
                return value
    return None


def ddg_result_urls(session, tender_ref, domain):
    query = f'site:{domain} "{tender_ref}"'

    response = session.get(
        "https://html.duckduckgo.com/html/",
        params={"q": query},
        headers=HEADERS,
        timeout=12,
    )

    if response.status_code != 200:
        return []

    urls = []

    for href in re.findall(r'href=["\']([^"\']+)["\']', response.text, flags=re.I):
        href = html.unescape(href)

        if "uddg=" in href:
            match = re.search(r"[?&]uddg=([^&]+)", href)
            if match:
                href = unquote(match.group(1))

        if href.startswith("//"):
            href = "https:" + href

        if href.startswith("http") and domain in href.lower():
            if href not in urls:
                urls.append(href)

        if len(urls) >= 4:
            break

    return urls


def check_candidate(session, tender_ref, source, url):
    try:
        response = session.get(
            url,
            headers=HEADERS,
            timeout=12,
            allow_redirects=True,
        )
    except Exception:
        return None

    if response.status_code != 200:
        return None

    page_text = clean_text(response.text)
    page_ref = normalise_ref(page_text)
    wanted_ref = normalise_ref(tender_ref)

    # Do not accept a secondary record unless the exact tender number is
    # visibly present on the candidate page.
    if not wanted_ref or wanted_ref not in page_ref:
        return None

    emd = extract_emd(page_text)
    fee = extract_fee(page_text)

    if not emd and not fee:
        return None

    return {
        "source": source,
        "url": response.url,
        "emd": emd,
        "tender_fee": fee,
    }


def lookup_secondary(tender_ref):
    session = requests.Session()

    attempts = []

    for source, domain in SEARCH_URLS:
        try:
            candidates = ddg_result_urls(session, tender_ref, domain)
        except Exception as exc:
            attempts.append({"source": source, "error": str(exc)[:160]})
            continue

        attempts.append({"source": source, "candidates": len(candidates)})

        for url in candidates:
            result = check_candidate(session, tender_ref, source, url)
            if result and result.get("emd"):
                return {
                    "success": True,
                    "tender_ref": tender_ref,
                    **result,
                    "attempts": attempts,
                }

    return {
        "success": False,
        "tender_ref": tender_ref,
        "message": "No verified secondary EMD was found for this tender number.",
        "attempts": attempts,
    }


class handler(BaseHTTPRequestHandler):

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=21600, s-maxage=21600")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        tender_ref = (query.get("tender", [""])[0] or "").strip()

        if not tender_ref:
            self.send_json(400, {"success": False, "message": "Tender number is required."})
            return

        if len(tender_ref) > 180:
            self.send_json(400, {"success": False, "message": "Tender number is too long."})
            return

        try:
            self.send_json(200, lookup_secondary(tender_ref))
        except Exception as exc:
            self.send_json(200, {
                "success": False,
                "tender_ref": tender_ref,
                "message": "Secondary lookup is temporarily unavailable.",
                "error": str(exc)[:180],
            })
