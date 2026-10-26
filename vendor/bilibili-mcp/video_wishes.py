"""已获批用户临时视频心愿的保守发送闸门。

Node 私信轮询写 dm-autoreply-state.json；Python 只读它，另外写独立的
video-wish-claims/ 发送占位与回执，避免两个进程互相覆盖 JSON。
API 接受 @ UID 映射不等于通知实际送达。
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

TOPIC_WORDS = {
    '颜值': ('美女', '小姐姐', '颜值', '帅哥', '美少女', '模特', '穿搭'),
    '美食': ('美食', '好吃', '探店', '下厨', '烹饪', '做饭', '厨房', '甜品', '蛋糕', '火锅', '烧烤', '零食', '食谱', '餐厅', '料理', '小吃', '奶茶'),
    '游戏': ('游戏', '电竞', '原神', '崩铁', '绝区零', '通关', '王者', '实况'),
    '宠物': ('宠物', '猫咪', '狗狗', '萌宠', '喵星', '铲屎官'),
    '科技': ('科技', '电脑', '编程', '人工智能', '机器人', '硬件', '手机', '数码', 'ai'),
    '音乐': ('音乐', '演唱', '歌曲', '翻唱', '钢琴', '乐器', '编曲'),
    '旅行': ('旅游', '旅行', '风景', '景点', '徒步', '露营'),
    '动画': ('动画', '动漫', '番剧', '二次元', '新番'),
    '运动': ('运动', '健身', '篮球', '足球', '跑步', '瑜伽'),
}

def verified_topic(topic, title, description=''):
    """仅能用 B 站真实视频元数据核对；不能相信模型自述标题。"""
    terms = TOPIC_WORDS.get(str(topic), ())
    content = (str(title or '') + ' ' + str(description or '')[:500]).lower()
    return bool(terms and any(word.lower() in content for word in terms))

def _load(db_file):
    try:
        data = json.loads(Path(db_file).read_text('utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}

def get_approved_wish(home, wish_id, now_ms=None):
    if not re.fullmatch(r'[0-9a-f-]{36}', str(wish_id), re.I):
        return None
    data = _load(Path(home) / 'dm-autoreply-state.json')
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    for uid, person in (data.get('people') or {}).items():
        if not re.fullmatch(r'[1-9][0-9]{0,18}', uid) or not isinstance(person, dict):
            continue
        if (person.get('approval') or {}).get('status') != 'approved':
            continue
        for wish in person.get('videoWishes') or []:
            if (isinstance(wish, dict) and wish.get('id') == wish_id and
                wish.get('status') == 'active' and int(wish.get('expiresAt') or 0) > now_ms and
                str(wish.get('uid')) == uid and wish.get('topic') in TOPIC_WORDS):
                limit = int(wish.get('limit') or 0)
                if 1 <= limit <= 10:
                    return {**wish, 'uid': uid}
    return None

def _claims(home, wish_id):
    folder = Path(home) / 'video-wish-claims'
    results = []
    for path in list(folder.glob(wish_id + '--*.json'))[:120]:
        data = _load(path)
        if data.get('id') == wish_id and data.get('status') in ('reserved', 'accepted', 'uncertain'):
            results.append(data)
    return results

def claim_wish(home, wish_id, bvid, *, now_ms=None):
    """单进程／多进程下原子保留一次发送资格；失败关闭，不会超额刷 @。"""
    home = Path(home)
    if not re.fullmatch(r'BV[0-9A-Za-z]{10}', str(bvid)):
        return None
    folder = home / 'video-wish-claims'
    folder.mkdir(parents=True, exist_ok=True)
    lock = folder / 'claims.lock'
    fd = None
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.write(fd, str(os.getpid()).encode())
    except FileExistsError:
        return None
    try:
        wish = get_approved_wish(home, wish_id, now_ms)
        if not wish:
            return None
        hash_bv = hashlib.sha256(bvid.encode('ascii')).hexdigest()[:20]
        target = folder / (wish_id + '--' + hash_bv + '.json')
        if target.exists():
            return None
        if len(_claims(home, wish_id)) >= wish['limit']:
            return None
        event = {'id': wish_id, 'uid': wish['uid'], 'topic': wish['topic'],
                 'bvid': bvid, 'status': 'reserved', 'at': int(time.time() * 1000)}
        with target.open('x', encoding='utf-8') as f:
            json.dump(event, f, ensure_ascii=False)
        return target
    except (OSError, ValueError, TypeError):
        return None
    finally:
        if fd is not None:
            os.close(fd)
            try: lock.unlink()
            except OSError: pass

def finish_claim(path, *, accepted=False, rpid=''):
    if path is None: return
    try:
        path = Path(path)
        row = _load(path)
        if row.get('status') != 'reserved': return
        row['status'] = 'accepted' if accepted else 'uncertain'
        row['receiptRpid'] = str(rpid)[:30] if accepted else ''
        row['finishedAt'] = int(time.time() * 1000)
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(row, ensure_ascii=False), encoding='utf-8')
        tmp.replace(path)
    except (OSError, ValueError):
        # 发送结果不能因日志失败被误认为评论失败；占位保持 reserved 防重。
        pass
