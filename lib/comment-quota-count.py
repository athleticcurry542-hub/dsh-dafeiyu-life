#!/usr/bin/env python3
"""只读公开评论 SQLite 配额（与 MCP 用同一日期、同一张表）。"""
import datetime
import json
import pathlib
import sqlite3
import sys

home = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path.cwd()
db = home / "public-comment-quota.sqlite3"
day = datetime.datetime.now().strftime("%Y-%m-%d")
try:
    if not db.is_file():
        print(json.dumps({"ok": True, "day": day, "used": 0}))
    else:
        # 只读模式，避免统计接口擅自创建表或更改配额
        with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=3) as conn:
            count = conn.execute("SELECT COUNT(*) FROM public_comment_attempt WHERE day=?", (day,)).fetchone()[0]
        print(json.dumps({"ok": True, "day": day, "used": int(count)}))
except (sqlite3.Error, OSError) as exc:
    print(json.dumps({"ok": False, "error": str(exc)[:180]}))
