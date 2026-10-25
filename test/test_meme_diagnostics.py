"""Test only fixed-path local diagnostics; no live network, credentials, or Bilibili calls."""
import ast
from datetime import datetime
import json
import os
from pathlib import Path
import re
import tempfile
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py'


def _load(scope):
    tree = ast.parse(SOURCE.read_text('utf8'))
    names = ('_record_meme_event', '_public_no_mention_reason')
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]),str(SOURCE),'exec'), scope)
    return scope


def test_meme_diagnostics_sanitizes_and_persists():
    with tempfile.TemporaryDirectory() as temp:
        base = Path(temp)
        def write(rel,text):
            path=base / rel
            path.parent.mkdir(parents=True,exist_ok=True)
            path.open('a',encoding='utf8').write(text)
        scope={'datetime':datetime,'json':json,'os':os,'re':re,'sys':__import__('sys'),
               '_valid_bv':lambda s:s,'_append_home':write}
        f=_load(scope)['_record_meme_event']
        with patch.dict(os.environ,{'BILI_COMMENT_MEMES_ENABLED':'1'}):
            f({'success':True,'rpid':123},'BV1abc234567',0,'','', '这是认真的技术演示，图库没有合适表情')
            f({'success':True,'meme_image':{'status':'submitted_unverified'}},'BV1abc234568',0,'奶娃/奶龙大笑','翻车场面很搞笑','')
            f({'success':False,'meme_image':{'status':'uncertain_no_retry'}},'BV1abc234569',0,'其他/震惊','发送状态不确定','')
            f({'success':True},'BV1abc234570',23,'','', '')  # replies excluded
        records=list((base/'meme-diagnostics').glob('*.jsonl'))
        assert len(records)==1
        rows=[json.loads(x) for x in records[0].read_text('utf8').splitlines()]
        assert len(rows)==3
        assert rows[0]['status']=='ai_declined'
        assert rows[0]['reason'].startswith('这是认真的技术演示')
        assert rows[1]['submitted'] is True
        assert rows[1]['image']=='奶娃/奶龙大笑'
        assert rows[2]['status']=='uncertain_no_retry' and rows[2]['success'] is False
        assert all('cookie' not in json.dumps(x,ensure_ascii=False).lower() for x in rows)
        assert '梗图诊断' in (base/'duty.log').read_text('utf8')


def test_meme_diagnostics_disabled_writes_nothing():
    with tempfile.TemporaryDirectory() as tmp:
        base=Path(tmp)
        scope={'datetime':datetime,'json':json,'os':os,'re':re,'sys':__import__('sys'),
               '_valid_bv':lambda s:s,'_append_home':lambda *args:(_ for _ in ()).throw(Exception('Unexpected call'))}
        f=_load(scope)['_record_meme_event']
        with patch.dict(os.environ,{'BILI_COMMENT_MEMES_ENABLED':'0'}):
            f({'success':True},'BV1abc234567',0,'','','')
