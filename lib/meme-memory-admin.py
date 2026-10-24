#!/usr/bin/env python3
"""梗记忆只读列表 / 显式删除。只供插件自有 HTTP handler 调用。"""
import json
import sqlite3
import sys
from pathlib import Path


def result(obj):
    print(json.dumps(obj, ensure_ascii=False))


def main():
    try:
        if len(sys.argv) != 4:
            raise ValueError('参数格式错误')
        home = Path(sys.argv[1]).resolve()
        action, arg = sys.argv[2], sys.argv[3]
        if action not in ('list', 'delete'):
            raise ValueError('不支持的操作')
        db = (home / 'meme-memory.sqlite3').resolve()
        if not db.is_relative_to(home):
            raise ValueError('文件位置无效')
        if not db.exists():
            result({'ok':True,'total':0,'entries':[],'deleted':False})
            return
        conn = sqlite3.connect(str(db), timeout=5)
        conn.row_factory=sqlite3.Row
        try:
            if action == 'list':
                q = arg[:40]
                count = conn.execute('SELECT COUNT(*) FROM memes').fetchone()[0]
                if q:
                    rows = conn.execute('''SELECT id,name,aliases,meaning,kind,confidence,updated_at FROM memes
                         WHERE instr(name,?)>0 OR instr(aliases,?)>0 OR instr(meaning,?)>0
                         ORDER BY updated_at DESC LIMIT 30''',(q,q,q)).fetchall()
                else:
                    rows = conn.execute('''SELECT id,name,aliases,meaning,kind,confidence,updated_at FROM memes
                        ORDER BY updated_at DESC LIMIT 30''').fetchall()
                entries=[]
                for r in rows:
                    entry=dict(r)
                    entry['sources']=[dict(x) for x in conn.execute('''SELECT bvid,evidence_type,evidence,noted_at FROM meme_sources
                          WHERE meme_id=? ORDER BY noted_at DESC LIMIT 3''',(r['id'],)).fetchall()]
                    entry['visual_status']='外观未知（未识图）'
                    entries.append(entry)
                result({'ok':True,'total':count,'entries':entries})
            else:
                ident=int(arg)
                if ident < 1 or ident > 2147483647:
                    raise ValueError('非法记忆编号')
                with conn:
                    c=conn.execute('DELETE FROM memes WHERE id=?',(ident,))
                    conn.execute('DELETE FROM meme_sources WHERE meme_id=?',(ident,))
                result({'ok':True,'deleted':c.rowcount>0})
        finally:
            conn.close()
    except Exception as exc:
        result({'ok':False,'error':type(exc).__name__+': '+str(exc)[:100]})


if __name__ == '__main__':
    main()
