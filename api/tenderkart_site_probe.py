import re
from urllib.parse import urljoin

import requests

BASE="https://tenderkart.in"
PAGE=BASE+"/portal/karnataka/active"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"


def interesting(text):
    hits=[]
    patterns=[
        r'https?://[^"\'\s<>]{1,220}',
        r'/api/[^"\'\s<>]{1,180}',
        r'/[A-Za-z0-9_./-]*(?:search|tender|filter)[A-Za-z0-9_?&=./-]{0,160}',
    ]
    for pat in patterns:
        for m in re.finditer(pat,text or '',flags=re.I):
            s=m.group(0)
            low=s.lower()
            if any(x in low for x in ('_next/static','google','facebook','instagram','linkedin','youtube','analytics')):
                continue
            if s not in hits:
                hits.append(s[:220])
            if len(hits)>=80:
                return hits
    return hits


def run_probe():
    s=requests.Session()
    r=s.get(PAGE,headers={"User-Agent":UA,"Accept-Language":"en-IN,en;q=0.9"},timeout=10)
    scripts=[]
    if r.status_code==200:
        for src in re.findall(r'<script[^>]+src=["\']([^"\']+)',r.text,flags=re.I):
            u=urljoin(BASE,src)
            if u not in scripts:
                scripts.append(u)
    page_hits=interesting(r.text)
    chunk_hits=[]
    checked=[]
    for u in scripts[:30]:
        try:
            cr=s.get(u,headers={"User-Agent":UA,"Referer":PAGE},timeout=8)
            checked.append({"url":u,"http":cr.status_code,"bytes":len(cr.text or '')})
            if cr.status_code==200:
                for hit in interesting(cr.text):
                    if hit not in chunk_hits:
                        chunk_hits.append(hit)
                    if len(chunk_hits)>=120:
                        break
        except Exception as exc:
            checked.append({"url":u,"error":str(exc)[:100]})
        if len(chunk_hits)>=120:
            break
    return {"success":True,"page_http":r.status_code,"page_bytes":len(r.text or ''),"scripts":len(scripts),"page_hits":page_hits[:80],"chunk_hits":chunk_hits[:120],"checked":checked[:30]}
