"""Local user-provided Bilibili video comment pictures; explicit opt-in and bounded.

No path from the agent is ever used as a path.  This module only reads files under
BILI_DUTY_HOME/comment-memes with an exact filename stem supplied by the agent.
"""
from datetime import datetime
from contextlib import closing
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sqlite3
import urllib.parse
import urllib.request

EXTENSIONS = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'}
NAME = re.compile(r'^[^/\\\x00-\x1f<>:"|?*]{1,48}$')
MAX_BYTES = 8 * 1024 * 1024
MAX_FOLDER_DEPTH = 3
MAX_SCAN = 1200


def folder_of(home):
    home = Path(home).resolve()
    folder = home / 'comment-memes'
    if folder.is_symlink() or not folder.resolve().is_relative_to(home):
        raise ValueError('梗图目录不安全')
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    return folder


def _valid_segment(value):
    return bool(value and value not in ('.', '..') and NAME.fullmatch(value))


def _valid_selection(value):
    if not isinstance(value, str) or not value or len(value) > 180 or '\\' in value:
        return False
    parts = value.split('/')
    return 1 <= len(parts) <= MAX_FOLDER_DEPTH + 1 and all(_valid_segment(p) for p in parts) and Path(parts[-1]).suffix.lower() not in EXTENSIONS


def _list(home):
    folder = folder_of(home)
    items = []
    def walk(directory, parts):
        if len(items) >= MAX_SCAN:
            return
        for p in sorted(directory.iterdir(), key=lambda x: x.name.casefold()):
            if len(items) >= MAX_SCAN:
                break
            try:
                if p.is_symlink():
                    continue
                if p.is_dir() and len(parts) < MAX_FOLDER_DEPTH and _valid_segment(p.name):
                    walk(p, parts + [p.name])
                elif p.is_file() and p.suffix.lower() in EXTENSIONS and _valid_segment(p.stem):
                    name = '/'.join(parts + [p.stem])
                    size = p.stat().st_size
                    if len(name) <= 180 and 0 < size <= MAX_BYTES:
                        items.append({'name': name, 'type': p.suffix.lower(), 'bytes': size, 'path': p, 'category': parts[0] if parts else ''})
            except OSError:
                continue
    walk(folder, [])
    counts = {}
    for row in items:
        key = row['name'].casefold()
        counts[key] = counts.get(key, 0) + 1
    return [r for r in items if counts[r['name'].casefold()] == 1]


def list_names(home):
    """Return unambiguous extensionless category/name paths, never filesystem paths."""
    return [row['name'] for row in _list(home)[:100]]


def list_library(home, category='', limit=100):
    """Enumerate safe subfolders for an agent; results are data, never instructions."""
    items = _list(home)
    categories = {}
    for row in items:
        categories[row['category']] = categories.get(row['category'], 0) + 1
    cat_rows = [{'path': k, 'label': k or '根目录', 'count': v} for k,v in sorted(categories.items())]
    if category and (not _valid_segment(category)):
        raise ValueError('分类名称无效')
    filtered = [row for row in items if not category or row['category'] == category]
    count = max(1,min(100,int(limit)))
    return {'ok':True,'names':[r['name'] for r in filtered[:count]], 'categories':cat_rows,
            'total':len(items),'shown':min(len(filtered),count),'truncated':len(filtered)>count or len(items)>=MAX_SCAN}


def select_image(home, name):
    if not _valid_selection(name):
        raise ValueError('必须从梗图库选择完整的分类/名称，不允许扩展名或任意路径')
    folder = folder_of(home)
    items = [row for row in _list(home) if row['name'] == name]
    if len(items) != 1:
        raise ValueError('梗图不存在或名称重复；请先刷新梗图库')
    entry = items[0]
    path = entry['path']
    # Prevent symlinks anywhere along the selected relative path.
    relative = path.relative_to(folder)
    step = folder
    for component in relative.parts:
        step = step / component
        if step.is_symlink():
            raise ValueError('禁止读取符号链接梗图或目录')
    if not path.resolve().is_relative_to(folder.resolve()):
        raise ValueError('梗图不在安全目录内')
    data = path.read_bytes()
    if not data or len(data) > MAX_BYTES:
        raise ValueError('梗图为空或过大（最大8MB）')
    from PIL import Image, UnidentifiedImageError
    filename = path.name
    try:
        with Image.open(BytesIO(data)) as img:
            if img.format not in ('PNG', 'JPEG', 'GIF', 'WEBP'):
                raise ValueError('只允许真实的 PNG/JPEG/GIF/WebP 图片')
            if entry['type'] == '.webp' and img.format != 'WEBP':
                raise ValueError('WebP 文件内容与扩展名不符')
            w, h = img.size
            if w < 16 or h < 16 or w > 4096 or h > 4096 or w*h > 16_000_000:
                raise ValueError('梗图像素尺寸不合适')
            # B站不直接上传 WebP；静态转换时，动画只取第一帧。
            if img.format == 'WEBP':
                img.seek(0)
                has_alpha = 'A' in img.getbands() or 'transparency' in img.info
                frame = img.convert('RGBA' if has_alpha else 'RGB')
                buf = BytesIO()
                frame.save(buf, format='PNG')
                data = buf.getvalue()
                filename = path.stem + '.png'
                mime = 'image/png'
                if len(data) > MAX_BYTES:
                    raise ValueError('WebP 转换为 PNG 后超过8MB，请压缩图片后重试')
            else:
                img.load()
                mime = {'PNG':'image/png','JPEG':'image/jpeg','GIF':'image/gif'}[img.format]
    except (UnidentifiedImageError, OSError, EOFError):
        raise ValueError('文件内容不是有效图片') from None
    return {'name': name, 'data': data, 'type': mime, 'width': w, 'height': h, 'filename': filename}


def reserve_attempt(home, per_day, per_round, round_counter):
    """Daily quota is atomic across MCP processes. Per-round guarded in this process."""
    if len(round_counter) >= per_round:
        return 'round_limit'
    home = Path(home).resolve()
    dbpath = home / 'comment-meme-quota.sqlite3'
    day = datetime.now().strftime('%Y-%m-%d')
    with closing(sqlite3.connect(dbpath, timeout=10)) as db:
        db.execute('CREATE TABLE IF NOT EXISTS attempts(day TEXT PRIMARY KEY, used INTEGER NOT NULL)')
        db.execute('BEGIN IMMEDIATE')
        used = db.execute('SELECT used FROM attempts WHERE day=?',(day,)).fetchone()
        if (used[0] if used else 0) >= per_day:
            db.commit()
            return 'daily_limit'
        db.execute('INSERT INTO attempts(day,used) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1',(day,))
        db.commit()
    round_counter.add(len(round_counter) + 1)
    return 'reserved'


def _post_json(url, payload, content_type, credential, referer):
    """Never redirect credential-carrying upload/comment requests."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('B站图片上传禁止跳转')
    assert url.startswith('https://api.bilibili.com/')
    req = urllib.request.Request(url, data=payload, method='POST', headers={
        'User-Agent': 'Mozilla/5.0', 'Referer': referer,
        'Content-Type': content_type,
        'Cookie': 'SESSDATA='+str(credential.sessdata)+'; bili_jct='+str(credential.bili_jct),
    })
    with urllib.request.build_opener(NoRedirect()).open(req,timeout=18) as rsp:
        raw = rsp.read(250_001)
    if len(raw) > 250_000:
        raise ValueError('B站图片接口响应异常过大')
    return json.loads(raw)


def upload_image(image, cred):
    boundary = '----bili-meme-safe-boundary'
    csrf = str(cred.bili_jct)
    parts = []
    for key, value in [('category','daily'),('csrf',csrf)]:
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode('utf8'))
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="file_up"; filename="meme{Path(image["filename"]).suffix.lower()}"\r\nContent-Type: {image["type"]}\r\n\r\n').encode('utf8'))
    parts.extend([image['data'], b'\r\n', f'--{boundary}--\r\n'.encode()])
    res = _post_json('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', b''.join(parts),
                     'multipart/form-data; boundary='+boundary,cred,'https://www.bilibili.com/')
    if res.get('code') != 0:
        raise ValueError('梗图上传被 B站拒绝：'+str(res.get('code'))[:24])
    dat = res.get('data') or {}
    url = str(dat.get('image_url') or '')
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http','https') or not re.fullmatch(r'i\d+\.hdslb\.com',parsed.hostname or '') or not parsed.path.startswith('/bfs/'):
        raise ValueError('B站上传回执的图片地址不可信')
    return {'img_src': url, 'img_width': int(dat.get('image_width') or image['width']),
            'img_height': int(dat.get('image_height') or image['height']),
            'img_size': float(dat.get('img_size') or len(image['data']) / 1024)}


def send_with_image(bvid, aid, text, credential, img_record, mentioned=None):
    form = {'type':'1','oid':str(aid),'message':str(text), 'plat':'1',
            'csrf':str(credential.bili_jct),'pictures':json.dumps([img_record],ensure_ascii=False)}
    if mentioned:
        form['at_name_to_mid'] = json.dumps({x['name']:int(x['uid']) for x in mentioned},ensure_ascii=False)
    return _post_json('https://api.bilibili.com/x/v2/reply/add', urllib.parse.urlencode(form).encode('utf8'),
                      'application/x-www-form-urlencoded',credential,'https://www.bilibili.com/video/'+bvid)


def debug_event(home, event):
    home=Path(home).resolve()
    root=home/'comment-memes-debug'
    root.mkdir(parents=True,exist_ok=True)
    file=root/(datetime.now().strftime('%Y-%m-%d')+'.jsonl')
    event={k:str(v).replace('\n',' ').replace('\r',' ')[:120] for k,v in event.items()}
    event['at']=datetime.now().astimezone().isoformat(timespec='seconds')
    with file.open('a',encoding='utf8') as f:
        f.write(json.dumps(event,ensure_ascii=False)+'\n')
