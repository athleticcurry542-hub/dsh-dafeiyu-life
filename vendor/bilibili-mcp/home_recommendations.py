"""Read-only, one-page Bilibili homepage recommendations.

Uses only fixed api.bilibili.com URLs. No pagination / redirects / retry loops;
never persists credentials or marks videos as seen. Designed to fail closed so
keyword search can continue when Bilibili rejects the session or changes its API.
"""
import hashlib
import json
import re
import time
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

_API = 'https://api.bilibili.com'
_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
_MIXIN_INDICES = (46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,
                  33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,
                  26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52)

class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _api_get(path, params, sessdata):
    """Only fixed API paths; no redirect can forward a Cookie elsewhere."""
    if path not in ('/x/web-interface/nav', '/x/web-interface/wbi/index/top/feed/rcmd',
                    '/x/web-interface/index/top/rcmd'):
        raise ValueError('invalid endpoint')
    query = urlencode(params)
    url = _API + path + ('?' + query if query else '')
    if urlparse(url).hostname != 'api.bilibili.com':
        raise ValueError('invalid hostname')
    cookie = str(sessdata).strip()
    if not cookie or any(x in cookie for x in ('\r','\n',';')):
        raise ValueError('invalid credential')
    req = Request(url, headers={
        'User-Agent': _UA,
        'Accept': 'application/json',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': 'SESSDATA=' + cookie,
    })
    opener = build_opener(_NoRedirect())
    with opener.open(req, timeout=10) as resp:
        data = resp.read(1_048_577)
    if len(data) > 1_048_576:
        raise ValueError('response too large')
    obj = json.loads(data)
    if not isinstance(obj, dict) or obj.get('code') != 0:
        raise ValueError('API rejected the request')
    return obj.get('data')


def _signed_params(nav_data, params, *, now=None):
    imgs = nav_data.get('wbi_img', {}) if isinstance(nav_data, dict) else {}
    img = str(imgs.get('img_url', '')).split('/')[-1].split('.')[0]
    sub = str(imgs.get('sub_url', '')).split('/')[-1].split('.')[0]
    key = img + sub
    if len(key) < 64:
        raise ValueError('WBI key unavailable')
    mixin = ''.join(key[i] for i in _MIXIN_INDICES)[:32]
    d = {k: str(v) for k, v in params.items()}
    d['wts'] = str(int(time.time() if now is None else now))
    d = {k: ''.join(c for c in v if c not in "!'()*") for k, v in sorted(d.items())}
    encoded = urlencode(d)
    d['w_rid'] = hashlib.md5((encoded + mixin).encode('utf-8')).hexdigest()
    return d


def normalize_recommendations(data, max_count=12):
    """Filter ads/lives/sidebars, dedupe BVs, include only small public metadata."""
    if isinstance(data, dict):
        raw = data.get('item', data.get('items', []))
    else:
        raw = data
    if not isinstance(raw, list):
        return []
    videos, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = item.get('goto', '')
        if kind and kind != 'av':
            continue
        if item.get('is_ad') or item.get('ad_info') or item.get('business_info'):
            continue
        bvid = str(item.get('bvid', ''))
        if not re.fullmatch(r'BV[0-9A-Za-z]{10}', bvid) or bvid in seen:
            continue
        title = re.sub(r'<[^>]*>', '', str(item.get('title') or '')).strip()[:160]
        if not title:
            continue
        stat = item.get('stat') if isinstance(item.get('stat'), dict) else {}
        author = item.get('owner') if isinstance(item.get('owner'), dict) else {}
        rcmd = item.get('rcmd_reason') if isinstance(item.get('rcmd_reason'), dict) else {}
        def positive(x):
            try: return max(0, int(x))
            except (ValueError,TypeError,OverflowError): return 0
        videos.append({
            'bvid': bvid,
            'title': title,
            'author': str(author.get('name') or item.get('author') or '')[:80],
            'play': positive(stat.get('view', item.get('play'))),
            'review': positive(stat.get('reply', item.get('review'))),
            'danmaku': positive(stat.get('danmaku', item.get('danmaku'))),
            'duration': positive(item.get('duration')),
            'reason': str(rcmd.get('content') or '')[:100],
            'url': 'https://www.bilibili.com/video/' + bvid,
            'source': 'homepage_recommend',
        })
        seen.add(bvid)
        if len(videos) >= max_count:
            break
    return videos


def get_home_recommendations(sessdata, *, fetch=None):
    """Get at most 12 home candidates. Best-effort WBI, then legacy on failure."""
    fetch = fetch or _api_get
    data = None
    origin = ''
    # Bilibili's newer recommendation feed uses WBI signing.
    try:
        nav = fetch('/x/web-interface/nav', {}, sessdata)
        params = _signed_params(nav, {
            'fresh_type': 4,
            'ps': 12,
            'fresh_idx': 1,
            'fresh_idx_1h': 1,
            'brush': 1,
            'feed_version': 'V8',
            'homepage_ver': 1,
            'web_location': 1430650,
        })
        data = fetch('/x/web-interface/wbi/index/top/feed/rcmd', params, sessdata)
        origin = 'wbi_home_feed'
    except (ValueError, OSError, KeyError, TypeError):
        # One alternate endpoint, no retries, no credentials outside fixed Bili domain.
        try:
            data = fetch('/x/web-interface/index/top/rcmd',
                         {'version': 1, 'ps': 12, 'fresh_idx': 1}, sessdata)
            origin = 'legacy_home_feed'
        except (ValueError, OSError, KeyError, TypeError):
            return {'ok': False, 'status': 'unavailable',
                    'error': 'B站首页推荐接口当前不可用，请继续关键词搜索，不要反复重试',
                    'count': 0, 'videos': []}
    videos = normalize_recommendations(data)
    return {'ok': True, 'source': 'homepage_recommend', 'api': origin,
            'count': len(videos), 'videos': videos,
            'note': '仅候选标题/统计信息；必须判重、读字幕并评估质量后才算挑中。推荐可能与网页实际看到的顺序不同。'}
