import html
import re
from urllib.parse import unquote

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
REF = "KNNL/2025-26/IW/WORK_INDENT4114/CALL-2"
QUERY = f'"{REF}" TenderKart'
KNOWN_URL = "https://tenderkart.in/tender/3e3f8ef6-7303-41f6-92fc-4cb8501048f5"


def urls(text):
    out=[]
    for raw in re.findall(r'https?://[^\s"\'<>]+', text or '', flags=re.I):
        u=html.unescape(raw)
        if 'url?q=' in u:
            u=unquote(u.split('url?q=',1)[1].split('&',1)[0])
        if 'tenderkart.in' in u.lower() and u not in out:
            out.append(u[:350])
    return out[:12]


def run_probe():
    s=requests.Session()
    results=[]
    for qtype,query in [
        ("exact", QUERY),
        ("human", '"KNNL 2025 26 IW WORK INDENT4114 CALL 2" TenderKart Karnataka'),
        ("title", '"Improvements to Service Road" "Main canal of TLBC" TenderKart Karnataka'),
    ]:
        try:
            r=s.get("https://search.brave.com/search",params={"q":query,"source":"web"},headers={"User-Agent":UA,"Accept-Language":"en-IN,en;q=0.9"},timeout=8,allow_redirects=True)
            text=r.text or ''
            results.append({"engine":"brave","query_type":qtype,"http":r.status_code,"contains_tenderkart":'tenderkart.in' in text.lower(),"urls":urls(text)})
        except Exception as exc:
            results.append({"engine":"brave","query_type":qtype,"error":str(exc)[:140]})
    direct={}
    try:
        r=s.get(KNOWN_URL,headers={"User-Agent":UA,"Accept-Language":"en-IN,en;q=0.9"},timeout=8,allow_redirects=True)
        direct={"http":r.status_code,"final_url":r.url,"bytes":len(r.text or ''),"contains_ref":re.sub(r'[^a-z0-9]+','',REF.lower()) in re.sub(r'[^a-z0-9]+','',(r.text or '').lower())}
    except Exception as exc:
        direct={"error":str(exc)[:180]}
    return {"success":True,"results":results,"direct_tenderkart":direct}
