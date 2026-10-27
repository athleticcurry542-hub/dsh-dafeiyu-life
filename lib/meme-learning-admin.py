#!/usr/bin/env python3
"""Fixed-path cross-video meme evidence review. No network or AI access."""
import json,sqlite3,sys,re,datetime
from pathlib import Path

def operate(home,mode,payload=None):
    home=Path(home).resolve();file=home/'meme-memory.sqlite3'
    if not file.is_file() or file.is_symlink():return {'ok':True,'rows':[],'pending':0}
    con=sqlite3.connect(file,timeout=8);con.row_factory=sqlite3.Row
    try:
        with con:
            con.execute('''CREATE TABLE IF NOT EXISTS meme_observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,bvid TEXT NOT NULL,
                evidence TEXT NOT NULL,evidence_type TEXT NOT NULL,created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',UNIQUE(name,bvid))''')
        rows=[dict(r) for r in con.execute("SELECT * FROM meme_observations WHERE status='pending' ORDER BY id LIMIT 80")]
        if mode=='list':return {'ok':True,'rows':rows,'pending':len(rows)}
        if mode!='commit':return {'ok':False,'error':'unsupported'}
        if not isinstance(payload,dict):return {'ok':False,'error':'invalid payload'}
        entries=payload.get('entries') or []
        if not isinstance(entries,list) or len(entries)>3:return {'ok':False,'error':'too many entries'}
        byid={r['id']:r for r in rows};created=0
        with con:
            con.execute('BEGIN IMMEDIATE')
            for entry in entries:
                ids=entry.get('observation_ids') or []
                if not isinstance(ids,list) or len(ids)>12 or len(set(ids))!=len(ids) or any(type(i)!=int or i not in byid for i in ids):continue
                src=[byid[i] for i in ids]
                if len({r['bvid'] for r in src})<2:continue
                name=str(entry.get('name') or '').strip()[:48]
                if not name or any(r['name'].casefold()!=name.casefold() for r in src):continue
                meaning=str(entry.get('meaning') or '').strip()[:220]
                if len(meaning)<10 or re.search(r'https?://|(?:cookie|token|password|sessdata|secret)',meaning,re.I):continue
                kind=entry.get('kind') if entry.get('kind') in ('梗','角色','人物','系列','其他') else '其他'
                now=datetime.datetime.now().astimezone().isoformat(timespec='seconds')
                old=con.execute('SELECT id FROM memes WHERE key=?',(name.casefold(),)).fetchone()
                if old:mid=old['id']
                else:
                    cap=300
                    if con.execute('SELECT COUNT(*) FROM memes').fetchone()[0]>=cap:continue
                    cur=con.execute('''INSERT INTO memes(key,name,aliases,kind,meaning,confidence,created_at,updated_at,review_status)
                        VALUES(?,?,?,?,?,?,?,?,?)''',(name.casefold(),name,'',kind,meaning,'待核实',now,now,'approved'))
                    mid=cur.lastrowid;created+=1
                for r in src:
                    con.execute('''INSERT OR IGNORE INTO meme_sources(meme_id,bvid,evidence_type,evidence,noted_at)
                        VALUES(?,?,?,?,?)''',(mid,r['bvid'],r['evidence_type'],r['evidence'],r['created_at']))
                    con.execute("UPDATE meme_observations SET status='reflected' WHERE id=?",(r['id'],))
        return {'ok':True,'created':created,'reviewed':sum(len(e.get('observation_ids') or []) for e in entries)}
    finally:con.close()

if __name__=='__main__':
    try:
        home,mode=sys.argv[1:3]
        payload=json.loads(sys.stdin.read(8000)) if mode=='commit' else None
        print(json.dumps(operate(home,mode,payload),ensure_ascii=False))
    except Exception as exc:print(json.dumps({'ok':False,'error':str(exc)[:180]},ensure_ascii=False))
