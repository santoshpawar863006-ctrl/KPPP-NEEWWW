import re

import requests

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
REF="PWD/2025-26/BR/WORK_INDENT33868"
TITLE="Construction Of Hp Culverts At Km 10.13 And 10.29 On Raravi-belur Road"
URL="https://bidassist.com/karnataka-tenders/public-works-department/detail-6535bf38-b2a7-4729-a601-30ed8355c430"


def norm(v): return re.sub(r'[^a-z0-9]+','',str(v or '').lower())


def run_probe():
    s=requests.Session()
    out={"success":True}
    for name,url in [("detail",URL),("amp",URL+"/amp")]:
        try:
            r=s.get(url,headers={"User-Agent":UA,"Accept-Language":"en-IN,en;q=0.9"},timeout=10,allow_redirects=True)
            text=r.text or ''
            out[name]={"http":r.status_code,"final_url":r.url,"bytes":len(text),"contains_ref":norm(REF) in norm(text),"contains_title":norm(TITLE)[:45] in norm(text),"content_type":r.headers.get("content-type","")}
        except Exception as exc:
            out[name]={"error":str(exc)[:180]}
    queries=[
        f'site:bidassist.com/karnataka-tenders/public-works-department/detail "{REF}"',
        f'site:bidassist.com/karnataka-tenders/public-works-department "{TITLE}"',
        f'"{REF}" "Public Works Department" BidAssist Karnataka',
        f'"{TITLE}" "Ballari" BidAssist Karnataka',
    ]
    searches=[]
    for q in queries:
        try:
            r=s.get("https://search.brave.com/search",params={"q":q,"source":"web"},headers={"User-Agent":UA,"Accept-Language":"en-IN,en;q=0.9"},timeout=8)
            text=r.text or ''
            urls=[]
            snippets=[]
            for u in re.findall(r'href=["\'](https?://[^"\']+)["\']',text,flags=re.I):
                if 'bidassist.com' in u.lower() and u not in urls: urls.append(u[:350])
                if len(urls)>=12: break
            for marker in (REF,TITLE):
                i=text.lower().find(marker.lower())
                if i>=0: snippets.append(re.sub(r'\s+',' ',text[max(0,i-500):i+1000])[:1500])
            searches.append({"query":q,"http":r.status_code,"urls":urls,"contains_ref":norm(REF) in norm(text),"contains_title":norm(TITLE)[:45] in norm(text),"snippets":snippets[:2]})
        except Exception as exc:
            searches.append({"query":q,"error":str(exc)[:150]})
    out["searches"]=searches
    return out
