"""动态发布 API 的零模型调用测试：不需要 B站凭证或网络。"""
import ast
import asyncio
import json
import os
from pathlib import Path
import tempfile
import types
import urllib.request
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SRC=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf-8')
_ast=ast.parse(SRC)
FUNCS={'_dynamic_after_comment','_dynamic_enabled','_valid_bv'}
_subset=ast.Module(body=[n for n in _ast.body if isinstance(n,(ast.AsyncFunctionDef,ast.FunctionDef)) and n.name in FUNCS],type_ignores=[])
ns={'asyncio':asyncio,'os':os,'datetime':__import__('datetime').datetime,'json':json,
    'urllib':__import__('urllib'),'re':__import__('re'),'Path':Path,'_BV_PATTERN':__import__('re').compile(r'^BV[0-9A-Za-z]{10}$')}
exec(compile(ast.fix_missing_locations(_subset),'<extracted-bili-dynamic>','exec'),ns)

class FakeResponse:
    def __init__(self,raw=b'{"code":0,"data":{"dyn_id_str":"777"}}'):self.raw=raw
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self):return self.raw

CRED=types.SimpleNamespace(bili_jct='test_csrf',sessdata='test_sess')

def test_dynamic_disabled_is_no_http():
    with tempfile.TemporaryDirectory() as td,patch.dict(os.environ,{'BILI_SYNC_DYNAMIC':'0'}),patch.object(urllib.request,'urlopen',side_effect=AssertionError('HTTP must not happen')):
        ns['_DUTY_HOME']=Path(td)
        result=asyncio.run(ns['_dynamic_after_comment']('BV1TBHp6AEAC','喵',CRED,requested=True))
    assert result['status']=='disabled'

def test_dynamic_success_single_http_no_model_and_dedupe():
    calls=[]
    def fake_urlopen(req,timeout=None):
        calls.append(req)
        assert 'x/dynamic/feed/create/dyn?csrf=test_csrf' in req.full_url
        payload=json.loads(req.data.decode('utf-8'))
        comment=payload['dyn_req']['content']['contents'][0]['raw_text']
        assert '有大米饭！' in comment
        assert 'https://www.bilibili.com/video/BV1TBHp6AEAC' in comment
        return FakeResponse()
    with tempfile.TemporaryDirectory() as td,patch.dict(os.environ,{'BILI_SYNC_DYNAMIC':'1'}),patch.object(urllib.request,'urlopen',side_effect=fake_urlopen):
        ns['_DUTY_HOME']=Path(td)
        first=asyncio.run(ns['_dynamic_after_comment']('BV1TBHp6AEAC','有大米饭！',CRED))
        second=asyncio.run(ns['_dynamic_after_comment']('BV1TBHp6AEAC','有大米饭！',CRED))
    assert first['status']=='api_accepted_unverified'
    assert second['status']=='already_attempted'
    assert len(calls)==1

def test_dynamic_api_failure_keeps_locked_no_retry():
    calls=[]
    def fail(req,timeout=None):
        calls.append(1)
        return FakeResponse(json.dumps({"code":-412,"message":"风控"},ensure_ascii=False).encode("utf-8"))
    with tempfile.TemporaryDirectory() as td,patch.dict(os.environ,{'BILI_SYNC_DYNAMIC':'1'}),patch.object(urllib.request,'urlopen',side_effect=fail):
        ns['_DUTY_HOME']=Path(td)
        first=asyncio.run(ns['_dynamic_after_comment']('BV1TBHp6AEAC','你好',CRED))
        second=asyncio.run(ns['_dynamic_after_comment']('BV1TBHp6AEAC','你好',CRED))
    assert first['status']=='failed'
    assert second['status']=='already_attempted'
    assert len(calls)==1

def test_dynamic_cap_three_posts():
    called=[]
    def reply(req,timeout=None):called.append(1);return FakeResponse()
    with tempfile.TemporaryDirectory() as td,patch.dict(os.environ,{'BILI_SYNC_DYNAMIC':'1'}),patch.object(urllib.request,'urlopen',side_effect=reply):
        ns['_DUTY_HOME']=Path(td)
        for i in range(4):
            bv=f'BV1TBHp6AEA{i}'
            ret=asyncio.run(ns['_dynamic_after_comment'](bv,'内容',CRED))
            assert ret['status']==('daily_limit' if i==3 else 'api_accepted_unverified')
    assert len(called)==3

def test_public_comment_quota_is_shared_atomic_file():
    import sqlite3
    import uuid
    from datetime import datetime
    fn=next(n for n in _ast.body if isinstance(n,ast.FunctionDef) and n.name=='_reserve_comment_quota')
    mini=ast.Module(body=[fn],type_ignores=[])
    scope={'os':os, 'sqlite3':sqlite3,'datetime':datetime,'uuid':uuid,'_DUTY_HOME':None}
    exec(compile(ast.fix_missing_locations(mini),'<quota>', 'exec'),scope)
    with tempfile.TemporaryDirectory() as td,patch.dict(os.environ,{'BILI_COMMENT_DAILY_LIMIT':'2'}):
        scope['_DUTY_HOME']=Path(td)
        assert scope['_reserve_comment_quota']()[0] is True
        assert scope['_reserve_comment_quota']()[0] is True
        allowed,reason=scope['_reserve_comment_quota']()
        assert allowed is False and '2' in reason
    with tempfile.TemporaryDirectory() as td,patch.dict(os.environ,{'BILI_COMMENT_DAILY_LIMIT':'0'}):
        scope['_DUTY_HOME']=Path(td)
        assert scope['_reserve_comment_quota']()[0] is False
