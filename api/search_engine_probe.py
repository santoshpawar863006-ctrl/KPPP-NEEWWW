import html
import re
from urllib.parse import unquote

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
QUERY = '"KNNL/2025-26/IW/WORK_INDENT4114/CALL-2" TenderKart'


def urls(text):
    out=[]
    for raw in re.findall(r'https?://[^\s"\'<>]+', text or '', flags=re.I):
        u=html.unescape(raw)
        if 'url?q=' in u:
            u=unquote(u.split('url?q=',1)[1].split('&',1)[0])
        if 'tenderkart.in' in u.lower() and u not in out:
            out.append(u[:350])
    return out[:5]


def run_probe():
    s=requests.Session()
    engines=[
        ("google", "https://www.google.com/search", {"q":QUERY,"num":"10"}),
        ("google_in", "https://www.google.co.in/search", {"q":QUERY,"num":"10"}),
        ("yahoo", "https://search.yahoo.com/search", {"p":QUERY}),
        ("brave", "https://search.brave.com/search", {"q":QUERY,"source":"web"}),
        ("mojeek", "https://www.mojeek.com/search", {"q":QUERY}),
        ("bing", "https://www.bing.com/search", {"q":QUERY,"count":"10"}),
        ("ddg", "https://html.duckduckgo.com/html/", {"q":QUERY}),
    ]
    results=[]
    for name,url,params in engines:
        try:
            r=s.get(url,params=params,headers={"User-Agent":UA,"Accept-Language":"en-IN,en;q=0.9"},timeout=8,allow_redirects=True)
            text=r.text or ''
            found=urls(text)
            results.append({"engine":name,"http":r.status_code,"bytes":len(text),"contains_tenderkart":'tenderkart.in' in text.lower(),"urls":found})
        except Exception as exc:
            results.append({"engine":name,"error":str(exc)[:140]})
    return {"success":True,"query":QUERY,"results":results}
