#!/usr/bin/env python3
"""Secure local sticker-library ZIP export/import.

Usage:
  python sticker-archive.py HOME export   > archive.zip
  python sticker-archive.py HOME import   < archive.zip

The archive contains only supported image files under comment-memes, preserving
relative folders and filenames. Import is additive: existing files are never
overwritten. Users are expected to prepare directory structure/names before a
batch import; per-file rename belongs to the single-upload UI.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path, PurePosixPath
import sys
import zipfile

from PIL import Image, UnidentifiedImageError

EXTS={'.png':'PNG','.jpg':'JPEG','.jpeg':'JPEG','.gif':'GIF','.webp':'WEBP'}
MAX_IMAGE_BYTES=8*1024*1024
MAX_ARCHIVE_BYTES=128*1024*1024
MAX_UNCOMPRESSED_BYTES=192*1024*1024
MAX_FILES=2000
MAX_DEPTH=4  # up to 3 folders + filename
MAX_SEGMENT=64


def fail(msg: str, code: int = 2):
    sys.stderr.write(str(msg)[:300]+'\n')
    raise SystemExit(code)


def safe_root(home: str) -> Path:
    base=Path(home).resolve()
    root=(base/'comment-memes')
    root.mkdir(parents=True,exist_ok=True)
    if root.is_symlink() or not root.resolve().is_relative_to(base):
        fail('表情包目录不安全')
    return root


def valid_segment(s: str) -> bool:
    if not isinstance(s,str) or not s or s in ('.','..') or len(s)>MAX_SEGMENT:
        return False
    if any(ord(c)<32 for c in s) or any(c in '/\\<>:"|?*\x00' for c in s):
        return False
    return True


def safe_archive_name(name: str):
    if not isinstance(name,str) or not name or '\\' in name or '\x00' in name or len(name)>300:
        fail('压缩包内包含非法路径')
    p=PurePosixPath(name)
    parts=list(p.parts)
    if p.is_absolute() or not 1<=len(parts)<=MAX_DEPTH or any(not valid_segment(x) for x in parts[:-1]):
        fail('压缩包目录结构不符合要求（最多三级文件夹）')
    ext=Path(parts[-1]).suffix.lower()
    if ext not in EXTS:
        fail('压缩包只能包含 PNG、JPG、GIF、WebP 图片')
    stem=Path(parts[-1]).stem
    if not valid_segment(stem): fail('压缩包内图片名称不合法')
    return parts,ext


def validate_image(content: bytes, ext: str):
    if not content or len(content)>MAX_IMAGE_BYTES:
        fail('单张图片必须在 0～8MB 以内')
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format!=EXTS[ext]: fail('图片格式与扩展名不一致')
            w,h=image.size
            if not (16<=w<=4096 and 16<=h<=4096 and w*h<=16_000_000):
                fail('图片尺寸应在16～4096像素，最多1600万像素')
            image.verify()
    except (UnidentifiedImageError,OSError,EOFError):
        fail('压缩包中包含无法识别或不完整的图片')


def iter_library(root: Path):
    rows=[]
    for path in sorted(root.rglob('*'),key=lambda p:str(p).casefold()):
        if len(rows)>=MAX_FILES: fail('表情包超过2000张，无法完整导出')
        try:
            rel=path.relative_to(root)
        except ValueError:
            continue
        if path.is_symlink(): continue
        if path.is_dir(): continue
        if not path.is_file() or path.suffix.lower() not in EXTS: continue
        parts=list(rel.parts)
        if not 1<=len(parts)<=MAX_DEPTH: continue
        if any(not valid_segment(x if i<len(parts)-1 else Path(x).stem) for i,x in enumerate(parts)): continue
        size=path.stat().st_size
        if not 0<size<=MAX_IMAGE_BYTES: continue
        rows.append((path,rel.as_posix(),size))
    return rows


def export_zip(root: Path):
    rows=iter_library(root)
    if not rows: fail('当前图库没有可导出的表情包')
    total=sum(r[2] for r in rows)
    if total>MAX_UNCOMPRESSED_BYTES: fail('表情包图库超过单次导出上限 192MB')
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for path,rel,_ in rows:
            z.write(path,rel)
    data=buf.getvalue()
    if len(data)>MAX_ARCHIVE_BYTES: fail('表情包压缩包超过 128MB，请分目录整理后再导出')
    sys.stdout.buffer.write(data)


def import_zip(root: Path, raw: bytes):
    if not raw or len(raw)>MAX_ARCHIVE_BYTES: fail('ZIP 必须在 0～128MB 以内')
    pending=[];total=0;seen=set()
    try:
        z=zipfile.ZipFile(io.BytesIO(raw),'r')
    except (zipfile.BadZipFile,ValueError):
        fail('不是有效的 ZIP 压缩包')
    with z:
        infos=[i for i in z.infolist() if not i.is_dir()]
        # Harmless OS metadata is ignored; all other non-images are rejected.
        infos=[i for i in infos if not (i.filename.startswith('__MACOSX/') or PurePosixPath(i.filename).name=='.DS_Store')]
        if not infos: fail('ZIP 中没有可导入的图片')
        if len(infos)>MAX_FILES: fail('单次最多导入2000张图片')
        for info in infos:
            if info.flag_bits & 0x1: fail('不支持加密 ZIP')
            parts,ext=safe_archive_name(info.filename)
            if info.file_size<=0 or info.file_size>MAX_IMAGE_BYTES: fail('ZIP 中有图片超过 8MB')
            total+=info.file_size
            if total>MAX_UNCOMPRESSED_BYTES: fail('ZIP 解压后的图片总量超过 192MB')
            key='/'.join(parts).casefold()
            if key in seen: fail('ZIP 中存在大小写重复的图片路径')
            seen.add(key)
            target=root.joinpath(*parts)
            resolved_parent=target.parent.resolve()
            if not resolved_parent.is_relative_to(root.resolve()): fail('ZIP 路径越界')
            # Batch mode preserves user-prepared names/structure and never overwrites.
            if target.exists(): fail('图库已存在同路径图片：'+'/'.join(parts))
            # Match single-upload duplicate rule: same stem in same folder conflicts even across extensions.
            if target.parent.exists():
                for old in target.parent.iterdir():
                    if old.is_symlink(): continue
                    if old.is_file() and old.suffix.lower() in EXTS and old.stem.casefold()==target.stem.casefold():
                        fail('图库已存在同名表情包：'+'/'.join(parts[:-1]+[target.stem]))
            content=z.read(info)
            if len(content)!=info.file_size: fail('ZIP 图片读取不完整')
            validate_image(content,ext)
            pending.append((target,content,'/'.join(parts)))
    current=len(iter_library(root))
    if current+len(pending)>MAX_FILES: fail('导入后图库会超过2000张，请先整理现有素材')
    created=[]
    try:
        for target,content,_ in pending:
            target.parent.mkdir(parents=True,exist_ok=True)
            # Refuse symlink folders created/raced after validation.
            cursor=root
            for part in target.relative_to(root).parts[:-1]:
                cursor=cursor/part
                if cursor.is_symlink(): fail('分类目录不允许符号链接')
            with target.open('xb') as f: f.write(content)
            created.append(target)
    except Exception:
        for p in reversed(created):
            try: p.unlink()
            except OSError: pass
        raise
    sys.stdout.write(json.dumps({'ok':True,'imported':len(created),'total':current+len(created)},ensure_ascii=False))


def main():
    if len(sys.argv)!=3 or sys.argv[2] not in ('export','import'):
        fail('命令非法')
    root=safe_root(sys.argv[1]);op=sys.argv[2]
    if op=='export': export_zip(root)
    else: import_zip(root,sys.stdin.buffer.read(MAX_ARCHIVE_BYTES+1))

if __name__=='__main__':
    try: main()
    except SystemExit: raise
    except Exception as e: fail(str(e))
