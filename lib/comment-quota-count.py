#!/usr/bin/env python3
"""只读公开评论、附图与视觉额度；每日以 B站 MCP 相同的本机日期为准。"""
import datetime
import json
import pathlib
import sqlite3
import sys

home = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path.cwd()
day = datetime.datetime.now().strftime('%Y-%m-%d')

def query_usage(name, query):
    db=home/name
    if not db.is_file():
        return 0, None
    try:
        with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True,timeout=3) as conn:
            row=conn.execute(query,(day,)).fetchone()
            return max(0,int(row[0] if row else 0)),None
    except (sqlite3.Error,OSError):
        return None,'统计账本暂不可读'

used,error=query_usage('public-comment-quota.sqlite3','SELECT COUNT(*) FROM public_comment_attempt WHERE day=?')
meme_used,meme_error=query_usage('comment-meme-quota.sqlite3','SELECT used FROM attempts WHERE day=?')
vision_used,vision_error=query_usage('vision-usage.sqlite3','SELECT used FROM usage WHERE day=?')
print(json.dumps({'ok':error is None,'day':day,'used':used,'error':error,
                  'memeUsed':meme_used,'memeError':meme_error,
                  'visionUsed':vision_used,'visionError':vision_error}))
