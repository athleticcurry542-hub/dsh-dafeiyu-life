"""Bounded, deterministic comment-sticker name search. Never reads image pixels or calls AI.

Search is deliberately a recommendation, not authorization to upload an image.
The agent must select the exact verified name and decide whether the tone fits.
"""
import re
from comment_memes import _list

# Scene words typed by viewers often differ from the label on a picture.
# Match semantic intent against *file and folder names*, not assumed visual content.
_INTENTS = (
    ('战斗', re.compile(r'架枪|开火|战斗|战力|火力|战场|开战|战机|打仗|打架|打起来|交战|对线|开撕|开怼|炮火|作战|冲锋|起飞'),
     re.compile(r'战斗机|战机|战斗|开战|对线|开火|枪|炮|作战|出击|打架|火力')),
    ('白饭', re.compile(r'白饭|米饭|大米|饭量|吃饭|开饭|饭桶|冰箱|饿了|饿死|饥饿|煮饭'),
     re.compile(r'白饭|大米饭|米饭|吃饭|开饭|饭|冰箱|饥饿')),
    ('爆笑', re.compile(r'哈哈|大笑|笑死|笑疯|笑哭|爆笑|绷不住|难绷|太乐|乐死|乐子|好笑|搞笑|荒诞|离谱|滑稽'),
     re.compile(r'大笑|爆笑|狂笑|哈哈|笑哭|偷笑|坏笑|笑死|捧腹')),
    ('无语', re.compile(r'无语|逆天|吐槽|没眼看|看不下去|受不了|难绷|离谱|无奈|扶额'),
     re.compile(r'无语|白眼|吐槽|扶额|无奈|摊手|问号|难绷')),
    ('震惊', re.compile(r'震惊|惊呆|吓|惊了|卧槽|傻眼|什么鬼|目瞪口呆'),
     re.compile(r'震惊|惊呆|吃惊|惊恐|吓|傻眼|目瞪口呆')),
    ('哭泣', re.compile(r'哭了|呜呜|泪|伤心|委屈|难受|破防|心碎'),
     re.compile(r'哭|眼泪|流泪|委屈|伤心|破防')),
    ('庆祝', re.compile(r'庆祝|赢了|胜利|好耶|恭喜|开心|快乐|高兴'),
     re.compile(r'庆祝|胜利|好耶|开心|高兴|欢呼')),
    ('生气', re.compile(r'生气|愤怒|气死|恼火|暴怒|急眼|发火'),
     re.compile(r'生气|愤怒|气|暴怒|发火')),
)
# Reasonable literal phrases for name/description alignment, no private text or prompt inference.
_WORDS = ('战斗机','战斗','战力','开火','架枪','对线','白饭','米饭','大米饭','冰箱','吃饭','饭量',
          '大笑','爆笑','哈哈','笑死','吐槽','无语','离谱','白眼','翻白眼','震惊','惊呆',
          '委屈','哭泣','开心','庆祝','生气','吃瓜','围观','摸鱼','睡觉','躺平',
          '打工','老板','中转站','额度','模型','deepseek','奶蛙','奶娃','大肥鱼')


def search_library(home, query, limit=12):
    """Return up to `limit` names ordered by cheap scene/emotion and lexical matching.

    No claim that any picture's actual pixels have been viewed. The library's
    existing safe enumeration also rejects duplicate or unsafe file names.
    """
    query = re.sub(r'[\x00-\x1f\x7f]', ' ', str(query or ''))[:280].casefold()
    query = re.sub(r'\s+', ' ', query).strip()
    if not query:
        return {'ok': True, 'matches': [], 'searched': 0, 'total': 0}
    limit = max(1, min(20, int(limit or 12)))
    rows = _list(home)
    chosen_intents = [(label, target, min(4, len(pattern.findall(query)))) for label, pattern, target in _INTENTS if pattern.search(query)]
    terms = [word for word in _WORDS if word in query]
    scored = []
    for row in rows:
        name = row['name']
        stem = name.rsplit('/', 1)[-1].casefold()
        folder = name.rsplit('/', 1)[0].casefold() if '/' in name else ''
        score = 0
        signals = []
        for label, target, count in chosen_intents:
            if target.search(stem):
                score += 24 + count * 5
                signals.append(label + '情绪/场景')
            elif target.search(folder):
                score += 7 + count
                signals.append(label + '分类')
        for word in terms:
            if word in stem:
                score += 7 + min(5, len(word))
                signals.append('名称:' + word)
            elif word in folder:
                score += 3
                signals.append('分类:' + word)
        # For simple titles not covered by the synonym groups, match 2+ char
        # word fragments; ignore common two-char boilerplate that over-matches.
        if not score:
            chunks = re.findall(r'[\u3400-\u9fff]{2,}|[a-z0-9]{3,}', query)
            for chunk in chunks:
                if len(chunk) <= 5 and chunk in stem:
                    score += 5 + len(chunk)
                    signals.append('原词:' + chunk)
        if score:
            scored.append((score, len(signals), name, signals))
    scored.sort(key=lambda x: (-x[0], -x[1], x[2].casefold()))
    return {'ok': True, 'query': query[:120], 'total': len(rows), 'searched': len(rows),
            'matches': [{'name': name, 'score': score, 'signals': signals[:4]}
                        for score, _, name, signals in scored[:limit]],
            'truncated': len(scored) > limit,
            'notice': '只根据真实图片的名称/分类匹配；未识别图片画面，AI仍需判断语气是否合适。'}
