import re
from urllib.parse import urljoin

import requests

BASE="https://tenderkart.in"
PAGE=BASE+"/portal/karnataka/active"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
TOKENS=["/api/v1/tenders","/api/v1/parse-query","/api/v2/filters/options","URLSearchParams","keyword"]


def contexts(text, token, width=850):
    out=[]
    low=(text or '').lower()
    target=token.lower()
    pos=0
    while True:
        i=low.find(target,pos)
        if i<0: break
        start=max(0,i-width)
        end=min(len(text),i+len(token)+width)
        snippet=re.sub(r'\s+',' ',text[start:end]).strip()
        out.append(snippet[:1900])
        if len(out)>=4: break
        pos=i+len(token)
    return out


def run_probe():
    s=requests.Session()
    r=s.get(PAGE,headers={"User-Agent":UA,"Accept-Language":"en-IN,en;q=0.9"},timeout=10)
    scripts=[]
    if r.status_code==200:
        for src in re.findall(r'<script[^>]+src=["\']([^"\']+)',r.text,flags=re.I):
            u=urljoin(BASE,src)
            if u not in scripts:
                scripts.append(u)
    matches=[]
    for u in scripts[:45]:
        try:
            cr=s.get(u,headers={"User-Agent":UA,"Referer":PAGE},timeout=8)
            if cr.status_code!=200: continue
            for token in TOKENS:
                ctx=contexts(cr.text or '',token)
                if ctx:
                    matches.append({"script":u,"token":token,"contexts":ctx})
        except Exception:
            pass
        if len(matches)>=16:
            break
    return {"success":True,"page_http":r.status_code,"scripts":len(scripts),"matches":matches[:16]}
