"""No third-party dependencies needed: exercise the actual safe Python MCP retrieval functions."""
import ast
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

source = (Path(__file__).parents[1] / 'vendor' / 'bilibili-mcp' / 'mcp_server.py').read_text(encoding='utf-8')
parsed=ast.parse(source)
chosen=[n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name in ('_identity_public_memory','_try_public_memory_model_quota')]
module=ast.fix_missing_locations(ast.Module(body=chosen,type_ignores=[]))
env=globals().copy()
exec(compile(module,'mcp_server-memory-functions','exec'),env)

class PublicMemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.home=Path(self.tmp.name)
        (self.home/'long-term-memory').mkdir()
        (self.home/'long-term-memory'/'dafeiyu.json').write_text(json.dumps({'memories':[
            {'id':'pvt','text':'主人住在某个地方，喜欢喝茶','source':'main-session-ai','importance':.98,'category':'stable_profile'},
            {'id':'pub','text':'大肥鱼在 B站看到一段有趣的模型娘视频','source':'life-reflection','tags':['模型娘'],'importance':.7}
        ]},ensure_ascii=False),encoding='utf-8')
        self.orig={k:os.environ.get(k) for k in ('BILI_DUTY_HOME','BILI_MEMORY_DSH_ARGV','BILI_MEMORY_DAILY_LIMIT','BILI_MEMORY_CANDIDATES')}
        os.environ['BILI_DUTY_HOME']=str(self.home)
        os.environ.pop('BILI_MEMORY_DSH_ARGV',None)
        os.environ['BILI_MEMORY_DAILY_LIMIT']='1'
    def tearDown(self):
        for k,v in self.orig.items():
            if v is None: os.environ.pop(k,None)
            else: os.environ[k]=v
        self.tmp.cleanup()
    def test_readonly_only_public(self):
        result=env['_identity_public_memory']('模型娘',6)
        self.assertTrue(result['ok']);self.assertEqual(result['source'],'local')
        self.assertIn('模型娘',result['context'])
        self.assertNotIn('主人住在',result['context'])
        self.assertNotIn('pvt',result['ids'])
    def test_invalid_query(self):
        result=env['_identity_public_memory']('?',6)
        self.assertEqual(result['context'],'')
    def test_quota_durable(self):
        reserve=env['_try_public_memory_model_quota']
        self.assertTrue(reserve(self.home))
        self.assertFalse(reserve(self.home))
        self.assertTrue((self.home/'memory-search-quota.sqlite3').exists())

if __name__=='__main__':unittest.main()
