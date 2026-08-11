from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload, cache="no-store"):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", cache)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)

        if path == "/api/history":
            try:
                from api.history import fetch_history
                try:
                    page = max(0, int((query.get("page", ["0"])[0] or "0")))
                except Exception:
                    page = 0
                try:
                    size = min(100, max(20, int((query.get("size", ["100"])[0] or "100"))))
                except Exception:
                    size = 100
                payload = fetch_history(page, size)
                self.send_json(200, payload, "public, max-age=900, s-maxage=900")
            except Exception as exc:
                self.send_json(200, {
                    "success": False,
                    "message": "Closed tender history is temporarily unavailable.",
                    "error": str(exc)[:240],
                })
            return

        if path == "/api/award_result":
            tender_ref = (query.get("tender", [""])[0] or "").strip()
            if not tender_ref:
                self.send_json(400, {"success": False, "message": "Tender number is required."})
                return
            try:
                from api.award_result import lookup
                self.send_json(200, lookup(tender_ref), "public, max-age=21600, s-maxage=21600")
            except Exception as exc:
                self.send_json(200, {
                    "success": False,
                    "message": "Award lookup is temporarily unavailable.",
                    "error": str(exc)[:240],
                })
            return

        self.send_json(200, {"status": "API active"})
