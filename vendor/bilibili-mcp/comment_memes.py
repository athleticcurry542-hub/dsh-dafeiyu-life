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


def folder_of(home):
    home = Path(home).resolve()
    folder = home / 'comment-memes'
    if folder.is_symlink() or not folder.resolve().is_relative_to(home):
        raise ValueError('梗图目录不安全')
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    return folder


def _list(home):
    folder = folder_of(home)
    items = []
    for p in sorted(folder.iterdir(), key=lambda x: x.name.casefold()):
        if p.is_symlink() or not p.is_file() or p.suffix.lower() not in EXTENSIONS:
            continue
        if not NAME.fullmatch(p.stem) or p.stat().st_size > MAX_BYTES:
            continue
        items.append({'name': p.stem, 'type': p.suffix.lower(), 'bytes': p.stat().st_size})
        if len(items) >= 100:
            break
    return items


def list_names(home):
    """Only reveal safe image names; never expose arbitrary filesystem paths."""
    return [row['name'] for row in _list(home)]


def select_image(home, name):
    if not isinstance(name, str) or not NAME.fullmatch(name) or Path(name).suffix.lower() in EXTENSIONS:
        raise ValueError('请从梗图库清单中选择图片名称（不要填路径或扩展名）')
    folder = folder_of(home)
    items = [row for row in _list(home) if row['name'] == name]
    if len(items) != 1:
        raise ValueError('梗图不存在或名称重复；请先查看梗图库清单')
    entry = items[0]
    path = folder / (name + entry['type'])
    if path.is_symlink() or not path.resolve().is_relative_to(folder.resolve()):
        raise ValueError('禁止读取符号链接梗图')
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
            # 评论上传链路先使用已支持的 PNG/GIF/JPEG，不把 WebP 原样提交给接口。
            # 动态 WebP 只取首帧；不声称 B站会展示动画。
            if img.format == 'WEBP':
                img.seek(0)
                has_alpha = 'A' in img.getbands() or 'transparency' in img.info
                frame = img.convert('RGBA' if has_alpha else 'RGB')
                buf = BytesIO()
                frame.save(buf, format='PNG')
                data = buf.getvalue()
                filename = name + '.png'
                mime = 'image/png'
                if len(data) > MAX_BYTES:
                    raise ValueError('WebP 转换为 PNG 后超过8MB，请压缩图片后重试')
            else:
                # Verify actual content rather than trusting an extension or just image headers.
                img.load()
                mime = {'PNG':'image/png','JPEG':'image/jpeg','GIF':'image/gif'}[img.format]
    except (UnidentifiedImageError, OSError, EOFError) as exc:
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
