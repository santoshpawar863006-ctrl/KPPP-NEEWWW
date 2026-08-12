import json
from datetime import datetime, timezone
from pathlib import Path

import requests

KPPP_BASE = "https://kppp.karnataka.gov.in"
KPPP_WORKS = KPPP_BASE + "/supplier-registration-service/v1/api/portal-service/works/search-eproc-tenders"
TENDERKART = "https://tenderkart.in/api/v1/tenders"
DATA_FILE = Path(__file__).resolve().parents[1] / "public" / "tenders.json"
HEALTH_FILE = Path(__file__).resolve().parents[1] / "public" / "health.json"


def _age_hours(value):
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600)
    except Exception:
        return None


def _database_status():
    out = {"ok": False, "status": "unknown", "age_hours": None, "count": 0, "category_counts": {}}
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        generated = data.get("generated_at")
        age = _age_hours(generated)
        count = int(data.get("count") or 0)
        counts = data.get("category_counts") or {}
        out.update({
            "ok": count > 0 and age is not None and age <= 6,
            "status": "fresh" if age is not None and age <= 2 else ("stale" if age is not None and age <= 6 else "very_stale"),
            "generated_at": generated,
            "age_hours": round(age, 2) if age is not None else None,
            "count": count,
            "category_counts": {
                "WORKS": int(counts.get("WORKS") or 0),
                "GOODS": int(counts.get("GOODS") or 0),
                "SERVICES": int(counts.get("SERVICES") or 0),
            },
        })
    except Exception as exc:
        out["error"] = str(exc)[:160]
    try:
        if HEALTH_FILE.exists():
            out["collector"] = json.loads(HEALTH_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return out


def _probe_kppp(session):
    try:
        r = session.post(
            KPPP_WORKS,
            params={"page": 0, "size": 1, "order-by-tender-publish": "true"},
            json={"category": "WORKS", "status": "PUBLISHED", "title": ""},
            headers={
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": KPPP_BASE,
                "Referer": KPPP_BASE + "/",
                "Post": "CONTRACTOR-EPROC-CONTRACTOR",
                "User-Agent": "Mozilla/5.0 Chrome/124.0",
            },
            timeout=8,
        )
        total = r.headers.get("X-Total-Count")
        return {"ok": r.status_code == 200, "http": r.status_code, "reported_works": int(total) if total and total.isdigit() else None}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:160]}


def _probe_tenderkart(session):
    try:
        r = session.get(
            TENDERKART,
            params={"keywords": "Karnataka", "state": "Karnataka", "limit": "1"},
            headers={"Accept": "application/json, text/plain, */*", "User-Agent": "Mozilla/5.0 Chrome/124.0"},
            timeout=8,
        )
        valid = False
        if r.status_code == 200:
            try:
                payload = r.json()
                valid = isinstance(payload, dict) and isinstance(payload.get("data"), list)
            except Exception:
                valid = False
        return {"ok": r.status_code == 200 and valid, "http": r.status_code}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:160]}


def get_system_health():
    session = requests.Session()
    database = _database_status()
    kppp = _probe_kppp(session)
    tenderkart = _probe_tenderkart(session)
    overall = bool(database.get("ok") and kppp.get("ok"))
    return {
        "success": True,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "overall": "healthy" if overall else "attention",
        "database": database,
        "kppp": kppp,
        "tenderkart": tenderkart,
        "bidassist": {"status": "search_based", "note": "Checked only when a tender search is requested."},
        "tendersplus": {"status": "search_based", "note": "Checked only when a tender search is requested."},
    }
