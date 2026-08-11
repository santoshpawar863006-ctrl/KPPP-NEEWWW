from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
import html
import json
import re
import requests

SOURCES = [
    ("BidEasy", "tenders.infralens.in"),
    ("TenderKart", "tenderkart.in"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
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


def norm(v):
    return re.sub(r"[^a-z0-9]+", "", str(v or "").lower())


def parse_money(number, unit=None):
    try:
        value = float(str(number).replace(",", "").strip())
    except Exception:
        return None
    u = str(unit or "").lower()
    if u in ("l", "lakh", "lakhs", "lac", "lacs"):
        value *= 100000
    elif u in ("cr", "crore", "crores"):
        value *= 10000000
    return value if value > 0 else None


def search_urls(session, tender_ref, domain):
    response = session.get(
        "https://html.duckduckgo.com/html/",
        params={"q": f'site:{domain} "{tender_ref}"'},
        headers=HEADERS,
        timeout=12,
    )
    if response.status_code != 200:
        return []

    urls = []
    for href in re.findall(r'href=["\']([^"\']+)["\']', response.text, flags=re.I):
        href = html.unescape(href)
        if "uddg=" in href:
            m = re.search(r"[?&]uddg=([^&]+)", href)
            if m:
                href = unquote(m.group(1))
        if href.startswith("//"):
            href = "https:" + href
        if href.startswith("http") and domain in href.lower() and href not in urls:
            urls.append(href)
        if len(urls) >= 4:
            break
    return urls


def extract_bidders(text):
    bidders = []

    # Strongest public prose pattern currently seen on BidEasy result pages.
    patterns = [
        (r"([A-Z0-9&.,()\-/ ]{3,100}?)\s+was\s+the\s+lowest\s+bidder\s*\(L1\)\s+at\s+₹?\s*([0-9][0-9,.]*)\s*(Cr|Crores?|L|Lakhs?|Lacs?)?", "L1"),
        (r"lowest\s+bidder\s*\(L1\)\s*[:\-]?\s*([A-Z0-9&.,()\-/ ]{3,100})", "L1"),
        (r"successful\s+(?:bidder|contractor)\s*[:\-]?\s*([A-Z0-9&.,()\-/ ]{3,100})", "AWARDEE"),
        (r"accepted\s+contractor\s*[:\-]?\s*([A-Z0-9&.,()\-/ ]{3,100})", "AWARDEE"),
    ]

    for pattern, rank in patterns:
        for m in re.finditer(pattern, text, flags=re.I):
            name = re.sub(r"\s+", " ", m.group(1)).strip(" .,-")
            if len(name) < 3:
                continue
            amount = None
            if m.lastindex and m.lastindex >= 2 and rank == "L1":
                amount = parse_money(m.group(2), m.group(3) if m.lastindex >= 3 else None)
            key = (name.lower(), rank)
            if not any((x["name"].lower(), x["rank"]) == key for x in bidders):
                bidders.append({"name": name, "rank": rank, "amount": amount})

    return bidders[:10]


def extract_result(text):
    lower = text.lower()
    bidders = extract_bidders(text)

    awarded = bool(re.search(r"\b(?:award(?:ed)?|aoc|award of contract|successful bidder|accepted contractor)\b", lower))
    provisional = bool(re.search(r"l1\s+is\s+provisional|award\s+has\s+not\s+been\s+declared|financial bid opening", lower))

    # Provisional L1 must never be presented as an awarded contractor.
    if provisional:
        awarded = False

    accepted_amount = None
    for pattern in (
        r"(?:awarded|accepted|contract)\s+(?:amount|value)\s*[:\-]?\s*₹?\s*([0-9][0-9,.]*)\s*(Cr|Crores?|L|Lakhs?|Lacs?)?",
        r"award\s+value\s*[:\-]?\s*₹?\s*([0-9][0-9,.]*)\s*(Cr|Crores?|L|Lakhs?|Lacs?)?",
    ):
        m = re.search(pattern, text, flags=re.I)
        if m:
            accepted_amount = parse_money(m.group(1), m.group(2) if m.lastindex >= 2 else None)
            if accepted_amount:
                break

    participant_count = None
    m = re.search(r"([0-9]+)\s+bidders?\s+participated", text, flags=re.I)
    if m:
        participant_count = int(m.group(1))

    return {
        "awarded": awarded,
        "provisional": provisional,
        "bidders": bidders,
        "accepted_amount": accepted_amount,
        "participant_count": participant_count,
    }


def lookup(tender_ref):
    session = requests.Session()
    attempts = []
    best = None

    for source, domain in SOURCES:
        try:
            candidates = search_urls(session, tender_ref, domain)
        except Exception as exc:
            attempts.append({"source": source, "error": str(exc)[:150]})
            continue

        attempts.append({"source": source, "candidates": len(candidates)})

        for url in candidates:
            try:
                response = session.get(url, headers=HEADERS, timeout=12, allow_redirects=True)
            except Exception:
                continue
            if response.status_code != 200:
                continue

            text = clean_text(response.text)
            if norm(tender_ref) not in norm(text):
                continue

            parsed = extract_result(text)
            candidate = {
                "source": source,
                "url": response.url,
                **parsed,
            }

            if candidate["awarded"] and candidate["bidders"]:
                return {"success": True, "tender_ref": tender_ref, "result": candidate, "attempts": attempts}

            if candidate["bidders"] or candidate["provisional"]:
                best = candidate

    if best:
        return {"success": True, "tender_ref": tender_ref, "result": best, "attempts": attempts}

    return {
        "success": False,
        "tender_ref": tender_ref,
        "message": "No verified public award/result record was found for this tender number.",
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
            self.send_json(200, lookup(tender_ref))
        except Exception as exc:
            self.send_json(200, {"success": False, "message": "Award lookup is temporarily unavailable.", "error": str(exc)[:180]})
