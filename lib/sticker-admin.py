#!/usr/bin/env python3
"""Local-only picture library administrator; never accepts URLs or arbitrary paths.
CLI: python sticker-admin.py HOME list|upload|rename|delete [stdin JSON]
"""
import base64
import binascii
import io
import json
import os
from pathlib import Path
import re
import sys
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

EXTS={'.png':'PNG','.jpg':'JPEG','.jpeg':'JPEG','.gif':'GIF','.webp':'WEBP'}
MAX_BYTES=8*1024*1024
MAX_FILES=2000
NAME=re.compile(r'^[^/\\\x00-\x1f<>:"|?*]{1,64}$')


def clean_segment(s):
    if not isinstance(s,str) or s in ('','.','..') or not NAME.fullmatch(s):
        raise ValueError('文件名或分类名非法（最长64字，不允许路径字符）')
    return s


def safe_folder(home):
    root=(Path(home).resolve()/'comment-memes')
    if root.is_symlink() or not root.resolve().is_relative_to(Path(home).resolve()):
        raise ValueError('表情包目录不安全')
    root.mkdir(parents=True,exist_ok=True)
    return root


def scans(root):
    result=[]
    def walk(folder,parts):
        for path in sorted(folder.iterdir(),key=lambda p:p.name.casefold()):
            if len(result)>=2000:break
            if path.is_symlink():continue
            if path.is_dir() and len(parts)<3:
                try:clean_segment(path.name)
                except ValueError:continue
                walk(path,parts+[path.name])
            elif path.is_file() and path.suffix.lower() in EXTS:
                try:clean_segment(path.stem)
                except ValueError:continue
                try:
                    size=path.stat().st_size
                    if not 0<size<=MAX_BYTES:continue
                except OSError:continue
                result.append({'name':'/'.join(parts+[path.stem]),'file':path,'ext':path.suffix.lower(), 'bytes':size,
                               'category':parts[0] if parts else ''})
    walk(root,[])
    counts={}
    for e in result:counts[e['name'].casefold()]=counts.get(e['name'].casefold(),0)+1
    return [e for e in result if counts[e['name'].casefold()]==1]


def find(rows,name):
    matches=[r for r in rows if r['name']==name]
    if len(matches)!=1:raise ValueError('找不到唯一的表情包，请刷新列表')
    return matches[0]


def dest_name(root,name,ext,previous=None):
    if not isinstance(name,str) or len(name)>180 or '\\' in name:raise ValueError('名称格式错误')
    parts=name.split('/')
    if not 1<=len(parts)<=4:raise ValueError('只能使用最多三级分类')
    for x in parts:clean_segment(x)
    target=root.joinpath(*parts[:-1],parts[-1]+ext)
    if not target.resolve().is_relative_to(root.resolve()):raise ValueError('目标目录不安全')
    cursor=root
    for part in parts[:-1]:
        cursor=cursor/part
        if cursor.is_symlink():raise ValueError('分类不允许符号链接')
    parent=target.parent
    if parent.exists() and not parent.is_dir():raise ValueError('分类名冲突')
    if parent.exists():
        for item in parent.iterdir():
            if item.is_symlink():continue
            if item.suffix.lower() in EXTS and item.stem.casefold()==parts[-1].casefold() and item!=previous:
                raise ValueError('此分类里已存在同名表情包（扩展名不同也视为重复）')
    return target


def validate_image(content,ext):
    if not content or len(content)>MAX_BYTES:raise ValueError('图片大小必须在0～8MB以内')
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format!=EXTS[ext]:raise ValueError('图片格式与扩展名不一致')
            width,height=image.size
            if not (16<=width<=4096 and 16<=height<=4096 and width*height<=16_000_000):
                raise ValueError('图片尺寸应在16～4096像素，最多1600万像素')
            image.verify()
    except (UnidentifiedImageError,OSError,EOFError) as e:
        raise ValueError('图片文件不完整或无法识别') from e


def main():
    try:
        if len(sys.argv)!=3 or sys.argv[2] not in ('list','upload','rename','delete'):
            raise ValueError('命令非法')
        root=safe_folder(sys.argv[1]);op=sys.argv[2]
        rows=scans(root)
        if op=='list':
            print(json.dumps({'ok':True,'total':len(rows),'items':[{k:v for k,v in x.items() if k!='file'} for x in rows]},ensure_ascii=False));return
        data=json.load(sys.stdin)
        if op=='upload':
            if len(rows)>=MAX_FILES:raise ValueError('表情包最多保留2000张，请先整理')
            ext=str(data.get('ext','')).lower()
            if ext not in EXTS:raise ValueError('仅支持 PNG、JPG、GIF、WEBP')
            content=base64.b64decode(data.get('data',''),validate=True)
            validate_image(content,ext)
            name=data.get('name')
            target=dest_name(root,name,ext)
            target.parent.mkdir(parents=True,exist_ok=True)
            tmp=target.parent/('.upload-'+uuid4().hex)
            try:
                with tmp.open('xb') as handle:handle.write(content)
                if target.exists():raise ValueError('目标文件已存在')
                os.link(tmp,target)  # 原子创建，存在同名文件时拒绝覆盖
            finally:
                if tmp.exists():tmp.unlink()
            result={'ok':True,'name':name}
        elif op=='rename':
            old=find(rows,data.get('name'))
            new=data.get('newName')
            target=dest_name(root,new,old['ext'],previous=old['file'])
            if target!=old['file']:
                target.parent.mkdir(parents=True,exist_ok=True)
                if target.exists():raise ValueError('目标文件已存在')
                old['file'].rename(target)
            result={'ok':True,'name':new}
        else:
            old=find(rows,data.get('name'))
            old['file'].unlink()
            result={'ok':True,'deleted':True}
        print(json.dumps(result,ensure_ascii=False))
    except (ValueError,binascii.Error,KeyError,TypeError,OSError) as e:
        print(json.dumps({'ok':False,'error':str(e)[:140]},ensure_ascii=False))

if __name__=='__main__':main()
