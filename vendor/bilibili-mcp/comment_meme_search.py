"""Bounded, deterministic comment-sticker name search. Never reads image pixels or calls AI.

Search is deliberately a recommendation, not authorization to upload an image.
The agent must select the exact verified name and decide whether the tone fits.
"""
import re
from comment_memes import _list

# v2.4.71: rules are a local, owner-editable JSON dataset, not hard-coded synonyms.
# `comment-meme-rules.json` is stored in BILI_DUTY_HOME and included in business backup.
from pathlib import Path
import json

_RULES_DEFAULT = 'comment_meme_rules_default.json'
_RULES_CUSTOM = 'comment-meme-rules.json'


def _valid_phrases(value):
    return (isinstance(value, list) and len(value) <= 36 and
            all(isinstance(x, str) and 1 <= len(x) <= 38 and
                not any(ord(c) < 32 for c in x) for x in value))


def validate_rules_payload(data):
    """Match the owner-editable schema for on-disk rules AND unsaved preview."""
    if (not isinstance(data, dict) or data.get('schema') != 1 or
            not isinstance(data.get('rules'), list) or len(data['rules']) > 100):
        raise ValueError('表情包检索规则格式不兼容')
    ids = set()
    for rule in data['rules']:
        if (not isinstance(rule, dict) or not isinstance(rule.get('id'), str) or
                not re.fullmatch(r'[a-z0-9_-]{1,48}',rule['id']) or rule['id'] in ids or
                not isinstance(rule.get('label'), str) or not rule['label'].strip() or len(rule['label']) > 65 or
                not isinstance(rule.get('enabled'), bool) or
                not _valid_phrases(rule.get('triggers')) or not rule['triggers'] or
                not _valid_phrases(rule.get('targets')) or not rule['targets'] or
                not _valid_phrases(rule.get('requireAny', [])) or
                not _valid_phrases(rule.get('excludeAny', []))):
            raise ValueError('表情包检索规则字段无效')
        ids.add(rule['id'])
    return data['rules']


def load_rules(home):
    path = Path(home).resolve() / _RULES_CUSTOM
    if not path.exists():
        path = Path(__file__).resolve().parent / _RULES_DEFAULT
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 100_000:
        raise ValueError('表情包检索规则文件不安全或过大')
    return validate_rules_payload(json.loads(path.read_text(encoding='utf-8')))


def _hits(query, words):
    return [w for w in words if w.casefold() in query]

# Reasonable literal phrases for name/description alignment, no private text or prompt inference.
_WORDS = ('战斗机','战斗','战力','开火','架枪','对线','白饭','米饭','大米饭','冰箱','吃饭','饭量',
          '大笑','爆笑','哈哈','笑死','吐槽','无语','离谱','白眼','翻白眼','震惊','惊呆',
          '委屈','哭泣','开心','庆祝','生气','吃瓜','围观','摸鱼','睡觉','躺平',
          '打工','老板','中转站','额度','模型','deepseek','奶蛙','奶娃','大肥鱼')


def search_library(home, query, limit=12, rules_override=None):
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
    rules = validate_rules_payload(rules_override) if rules_override is not None else load_rules(home)
    chosen_intents = []
    for rule in rules:
        if not rule['enabled']:
            continue
        matched = _hits(query, rule['triggers'])
        if not matched or (rule.get('requireAny') and not _hits(query, rule['requireAny'])):
            continue
        if rule.get('excludeAny') and _hits(query, rule['excludeAny']):
            continue
        chosen_intents.append((rule, min(4, len(matched))))
    terms = [word for word in _WORDS if word in query]
    scored = []
    for row in rows:
        name = row['name']
        stem = name.rsplit('/', 1)[-1].casefold()
        folder = name.rsplit('/', 1)[0].casefold() if '/' in name else ''
        score = 0
        signals = []
        for rule, count in chosen_intents:
            label = rule['label']
            if _hits(stem, rule['targets']):
                score += 24 + count * 5
                signals.append(label + '情绪/场景')
            elif _hits(folder, rule['targets']):
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
            'matchedRules': [{'id': r['id'], 'label': r['label'], 'targets': r['targets'][:4]} for r,_ in chosen_intents[:12]],
            'matches': [{'name': name, 'score': score, 'signals': signals[:4]}
                        for score, _, name, signals in scored[:limit]],
            'truncated': len(scored) > limit,
            'notice': '只根据真实图片的名称/分类匹配；未识别图片画面，AI仍需判断语气是否合适。'}
