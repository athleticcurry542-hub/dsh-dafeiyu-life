"""Create SQLite-consistent snapshots and restore them via SQLite backup API.
Only the three allowlisted local business ledgers are considered. No credentials.
"""
import base64
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

DBS = ('meme-memory.sqlite3', 'public-comment-quota.sqlite3', 'dynamic-sync/dynamic-limit.sqlite3')
MAX_SQLITE_SIZE = 24 * 1024 * 1024


def checked_root(root):
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError('数据目录不存在')
    return root


def snapshot(src):
    if not src.exists():
        return None
    with tempfile.TemporaryDirectory(prefix='dsh-sqlite-export-') as tmp:
        target = Path(tmp) / 'snapshot.sqlite3'
        with sqlite3.connect(src.as_uri() + '?mode=ro', uri=True, timeout=10) as conn:
            with sqlite3.connect(target) as dest:
                conn.backup(dest, pages=128, sleep=0.1)
        data = target.read_bytes()
    if len(data) > MAX_SQLITE_SIZE:
        raise ValueError(f'SQLite 数据库过大：{src.name}')
    return base64.b64encode(data).decode('ascii')


def export(root):
    return {p: value for p in DBS if (value := snapshot(root / p)) is not None}


def restore(root, encoded):
    if not isinstance(encoded, dict) or any(p not in DBS for p in encoded):
        raise ValueError('备份数据库列表不合法')
    with tempfile.TemporaryDirectory(prefix='dsh-sqlite-import-') as tmp:
        pending = []
        for i, (name, value) in enumerate(encoded.items()):
            if not isinstance(value, str) or len(value) > MAX_SQLITE_SIZE * 2:
                raise ValueError('SQLite 备份格式或体积不合法')
            data = base64.b64decode(value, validate=True)
            if not data.startswith(b'SQLite format 3\x00') or len(data) > MAX_SQLITE_SIZE:
                raise ValueError('SQLite 数据文件格式不合法')
            src = Path(tmp) / f'{i}.sqlite3'
            src.write_bytes(data)
            with sqlite3.connect(src) as db:
                result = db.execute('PRAGMA quick_check').fetchone()
                if not result or result[0] != 'ok':
                    raise ValueError('SQLite 备份完整性校验失败')
            pending.append((name, src))
        # All databases verified before modifying any on-disk database.
        for name, src in pending:
            dst = root / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(src, timeout=10) as source:
                with sqlite3.connect(dst, timeout=10) as target:
                    source.backup(target, pages=128, sleep=0.1)
    return len(pending)


def main():
    action, root_arg = sys.argv[1:3]
    root = checked_root(root_arg)
    if action == 'export':
        result = {'ok': True, 'sqlite': export(root)}
    elif action == 'restore':
        data = json.load(sys.stdin)
        result = {'ok': True, 'count': restore(root, data.get('sqlite', {}))}
    else:
        raise ValueError('无效动作')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)[:350]}, ensure_ascii=False))
        sys.exit(1)
