#!/usr/bin/env python3
"""Read-only media inspection; writes its evidence exclusively below skin-packs/audit."""
import pathlib,json,subprocess,hashlib,collections,concurrent.futures
from PIL import Image,ImageDraw,ImageFont
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'skin-packs/audit'
paths=sorted(p for folder in ('skin-packs/local/wiki-downloads','skin-packs/media') for p in (root/folder).rglob('*') if p.is_file() and p.suffix.lower()!='.json')
manifest=json.load(open(root/'skin-packs/local/wiki-downloads/download-manifest.json'))
sources=collections.defaultdict(list)
for c in manifest:
 for a in c['assets']: sources[a['file']].append({'page':c['page'],'url':a.get('url'),'resolved_url':a.get('resolved_url'),'sha256':a.get('sha256'),'bytes':a.get('bytes')})
def inspect(p):
 b=p.read_bytes();rel=str(p.relative_to(root));e={'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'magic_hex':b[:12].hex(),'sources':sources.get(rel,[])}
 if p.suffix.lower()=='.mp3':
  r=subprocess.run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(p)],capture_output=True,text=True)
  e['ffprobe']=json.loads(r.stdout or '{}');e['probe_error']=r.stderr.strip();e['valid']=r.returncode==0 and any(s['codec_type']=='audio' for s in e['ffprobe'].get('streams',[]))
  r=subprocess.run(['ffmpeg','-hide_banner','-v','error','-i',str(p),'-map','0:a:0','-vn','-sn','-dn','-f','null','-'],capture_output=True,text=True)
  e['decode_valid']=r.returncode==0;e['decode_diagnostics']=r.stderr.strip()
  r=subprocess.run(['ffmpeg','-hide_banner','-v','error','-i',str(p),'-map','0:a:0','-vn','-sn','-dn','-f','md5','-'],capture_output=True,text=True)
  e['decoded_audio_md5']=r.stdout.strip() if r.returncode==0 else None
 else:
  try:
   with Image.open(p) as im:
    e.update({'alpha_extrema':im.getchannel('A').getextrema() if im.mode=='RGBA' else None,'format':im.format,'size':im.size,'mode':im.mode,'frames':getattr(im,'n_frames',1),'image_info':{k:str(v)[:200] for k,v in im.info.items() if k not in ('icc_profile',)}});im.load();e['valid']=True
  except Exception as ex:e.update({'valid':False,'error':str(ex)})
 e['source_hash_matches']=all(s.get('sha256')==e['sha256'] and s.get('bytes')==len(b) for s in e['sources']) if e['sources'] else None
 return e
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:entries=list(pool.map(inspect,paths))
byhash=collections.defaultdict(list)
for e in entries:byhash[e['sha256']].append(e['path'])
summary={'inventory':{},'invalid':[e['path'] for e in entries if not e['valid'] or e.get('decode_valid') is False], 'unique_hashes':len(byhash),'duplicate_groups':[v for v in byhash.values() if len(v)>1],'manifest_entries':sum(len(c['assets']) for c in manifest),'manifest_unique_paths':len(sources),'source_hash_mismatch':[e['path'] for e in entries if e['source_hash_matches'] is False]}
for folder in ('skin-packs/local/wiki-downloads','skin-packs/media'):
 es=[e for e in entries if e['path'].startswith(folder+'/')];summary['inventory'][folder]={'files':len(es),'bytes':sum(e['bytes'] for e in es),'extensions':dict(collections.Counter(pathlib.Path(e['path']).suffix for e in es)),'collections':{}}
 for c in json.load(open(root/'skin-packs/catalog.json'))['collections']:
  xs=[e for e in es if e['path'].startswith(folder+'/'+c['id']+'/')];summary['inventory'][folder]['collections'][c['id']]={'files':len(xs),'bytes':sum(e['bytes'] for e in xs),'extensions':dict(collections.Counter(pathlib.Path(e['path']).suffix for e in xs))}
# Keep aggregate verification for every input, but detailed evidence only for
# audio and actual banner originals rather than unrelated wiki cosmetics.
details=[]
for e in entries:
 if not (e['path'].endswith('.mp3') or 'Kill_Banner' in e['path'] and not pathlib.Path(e['path']).name[0].isdigit()):continue
 item=dict(e)
 if 'ffprobe' in item:
  probe=item['ffprobe'];item['ffprobe']={'format':{k:v for k,v in probe.get('format',{}).items() if k in ('duration','tags')},'streams':[{k:v for k,v in s.items() if k in ('codec_type','codec_name','sample_rate','channels','duration')} for s in probe.get('streams',[])]}
 details.append(item)
audit_summary=dict(summary);audit_summary['total_duplicate_groups']=len(summary['duplicate_groups']);audit_summary['duplicate_groups']=[g for g in summary['duplicate_groups'] if g[0].endswith('.mp3')]
json.dump({'snapshot':'Read-only inventory of the files present when this script ran.','summary':audit_summary,'entries':details},open(out/'source-media-audit.json','w'),indent=2,ensure_ascii=False)
# Contact sheets use pixels on checkerboards; a label is provenance, not independent identity proof.
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
for name,selection,width,height,columns in [
 ('banners',[e for e in entries if '/wiki-downloads/' in e['path'] and 'Kill_Banner' in pathlib.Path(e['path']).name and not pathlib.Path(e['path']).name[0].isdigit()],270,300,5),
 ('catalog-weapons',[e for e in entries if '/wiki-downloads/' in e['path'] and pathlib.Path(e['path']).suffix=='.png' and not pathlib.Path(e['path']).name[0].isdigit() and any(w in pathlib.Path(e['path']).name for w in ('_Vandal.png','_Phantom.png','ORA_by_OneTap_Sheriff.png','ORA_by_OneTap_Operator.png'))],400,180,3)]:
 rows=(len(selection)+columns-1)//columns;sheet=Image.new('RGB',(width*columns,height*rows),(24,28,33));d=ImageDraw.Draw(sheet)
 for i,e in enumerate(selection):
  x=(i%columns)*width;y=(i//columns)*height
  for yy in range(y,y+height-45,14):
   for xx in range(x,x+width,14):d.rectangle((xx,yy,xx+13,yy+13),fill=(55,58,63) if ((xx-x)//14+(yy-y)//14)%2 else (37,41,45))
  im=Image.open(root/e['path']).convert('RGBA');im.thumbnail((width-20,height-65));sheet.paste(im,(x+(width-im.width)//2,y+(height-45-im.height)//2),im)
  label=pathlib.Path(e['path']).name
  for j in range(0,len(label),36 if name=='banners' else 52): d.text((x+6,y+height-43+j//(36 if name=='banners' else 52)*15),label[j:j+(36 if name=='banners' else 52)],font=font,fill='white')
 sheet.save(out/(name+'-contact-sheet.jpg'))
print(json.dumps(summary,ensure_ascii=False,indent=2))
