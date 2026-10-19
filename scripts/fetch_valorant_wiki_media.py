#!/usr/bin/env python3
"""Fetch user-authorized audio/images linked from VALORANT Wiki collection pages.

Usage:
  python3 scripts/fetch_valorant_wiki_media.py --dry-run
  python3 scripts/fetch_valorant_wiki_media.py --download

Requires: pip install requests beautifulsoup4
This script discovers files from page links; it does not guess filenames or extract protected assets.
Only content from wiki.playvalorant.com is downloaded. Files are placed outside git in
skin-packs/local/wiki-downloads so they can be reviewed before use.
"""
import argparse
import hashlib
import json
import mimetypes
import pathlib
import re
from urllib.parse import urljoin, urlparse, unquote
import requests
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "skin-packs" / "local" / "wiki-downloads"
BASE = "https://wiki.playvalorant.com"
PAGES = {
  "prelude-to-chaos": "Prelude_to_Chaos_Collection",
  "kuronami": "Kuronami_Collection",
  "primordium": "Primordium_Collection",
  "rogue": "Rogue_Collection",
  "rgx-11z-pro": "RGX_11z_Pro_Collection",
  "ayakashi": "Ayakashi_Collection",
  "nocturnum": "Nocturnum_Collection",
  "mystbloom": "Mystbloom_Collection",
  "ora-by-onetap": "ORA_by_OneTap_Collection",
}
EXTS = (".ogg", ".mp3", ".wav", ".flac", ".png", ".webp", ".jpg", ".jpeg")
ALLOW_MIME = ("audio/", "image/")
UA = "Miaozhun-Authorized-Asset-Research/1.0"
s = requests.Session()
s.headers.update({"User-Agent": UA})

def get_html(url):
    r = s.get(url, timeout=35)
    r.raise_for_status()
    return BeautifulSoup(r.text, "html.parser")

def discover(slug):
    page = BASE + "/en-us/" + slug
    soup = get_html(page)
    candidates = {}
    for tag in soup.select("a[href],audio[src],source[src],img[src]"):
        raw = tag.get("href") or tag.get("src")
        if not raw: continue
        u = urljoin(page, raw)
        p = urlparse(u)
        if not p.hostname or not (p.hostname == "wiki.playvalorant.com" or p.hostname.endswith(".wiki.playvalorant.com")):
            continue
        path = unquote(p.path)
        name = pathlib.PurePosixPath(path).name
        if path.lower().endswith(EXTS) or "/File:" in path or "Special:Redirect/file/" in path:
            candidates[u] = tag.get_text(" ", strip=True)[:200]
    return page, candidates

def resolve_file_page(url):
    if "/File:" not in unquote(urlparse(url).path):
        return url
    soup = get_html(url)
    for selector in (".fullMedia a.internal", ".fullMedia a[href]", "a.mw-thumbnail-link", "meta[property='og:audio']", "meta[property='og:image']"):
        element = soup.select_one(selector)
        if element:
            link = element.get("href") or element.get("content")
            if link: return urljoin(url, link)
    raise ValueError("Could not locate original media link on File page")

def fetch_media(url, dest):
    media_url = resolve_file_page(url)
    with s.get(media_url, stream=True, timeout=70) as r:
        r.raise_for_status()
        final = urlparse(r.url)
        # MediaWiki may redirect to Wikimedia upload hosts; only accept genuine media types.
        ct = r.headers.get("Content-Type", "").split(";",1)[0].lower()
        if not ct.startswith(ALLOW_MIME):
            raise ValueError("Not an image/audio file: " + ct)
        cd = r.headers.get("Content-Disposition", "")
        basename = pathlib.PurePosixPath(unquote(final.path)).name
        quoted = re.search(r"filename\*=UTF-8''([^;]+)", cd, re.I)
        if quoted: basename = unquote(quoted.group(1))
        basename = re.sub(r"[^-\w.]+", "_", basename)[:160]
        if not basename or "." not in basename:
            basename = hashlib.sha256(url.encode()).hexdigest()[:20] + (mimetypes.guess_extension(ct) or ".bin")
        dest.mkdir(parents=True, exist_ok=True)
        output = dest / basename
        tmp = output.with_suffix(output.suffix + ".part")
        length=0
        h=hashlib.sha256()
        with tmp.open("wb") as fh:
            for block in r.iter_content(chunk_size=1<<18):
                if not block: continue
                length += len(block)
                if length > 50_000_000: raise ValueError("File exceeds 50 MB safety limit")
                fh.write(block);h.update(block)
        if length < 100: raise ValueError("Suspiciously short media response")
        tmp.replace(output)
        return {"file":str(output.relative_to(ROOT)), "bytes":length, "sha256":h.hexdigest(), "url":url, "resolved_url":r.url, "mime":ct}

def main():
    a=argparse.ArgumentParser()
    g=a.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run",action="store_true")
    g.add_argument("--download",action="store_true")
    x=a.parse_args()
    report=[]
    for pack,slug in PAGES.items():
        item={"collection":pack,"page":BASE+"/en-us/"+slug,"assets":[],"errors":[]}
        try:
            page,assets=discover(slug)
            for url,title in assets.items():
                if x.dry_run: item["assets"].append({"url":url,"label":title})
                else:
                    try: item["assets"].append(fetch_media(url,OUT/pack))
                    except Exception as e: item["errors"].append({"url":url,"error":str(e)})
        except Exception as e: item["errors"].append({"page":item["page"],"error":str(e)})
        report.append(item)
        print(pack, "found",len(item["assets"]),"errors",len(item["errors"]),flush=True)
    if x.download:
        OUT.mkdir(parents=True,exist_ok=True)
        (OUT/"download-manifest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    else: print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=="__main__":main()
