"""独立抽取 MCP 梗库辅助函数执行，不加载真实 B站 SDK，不联网。"""
import ast
import json
import os
from unittest.mock import patch
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
text = (ROOT / 'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8')
tree = ast.parse(text)
wanted = {'_meme_clean','_meme_conn','_meme_lookup','_meme_save','_meme_capacity','_valid_bv'}
mod = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in wanted],type_ignores=[])
compiled = compile(mod,'<meme_memory>','exec')

class MemeMemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.home=Path(self.tmp.name)
        self.scope={'sqlite3':sqlite3,'re':re,'datetime':datetime,'Path':Path,'os':os,
                    '_DUTY_HOME':self.home,'_MEME_DB_NAME':'meme-memory.sqlite3',
                    '_MEME_FORBIDDEN':re.compile(r'(?i)(?:api[_-]?key|token|cookie|password|sessdata|https?://|[A-Za-z]:[\\/]|\.dsh[/\\]|-----BEGIN)'),
                    '_BV_PATTERN':re.compile(r'^BV[0-9A-Za-z]{10}$')}
        exec(compiled,self.scope)
        self.save=self.scope['_meme_save'];self.find=self.scope['_meme_lookup']
        self.bvid='BV1pXHK6mE6z'

    def tearDown(self):
        self.tmp.cleanup()

    def test_save_search_and_cross_process_reopen(self):
        r=self.save('奶蛙','视频里提到的一个二创梗，还不清楚形象',self.bvid,
                    '字幕里出现了“奶蛙”两个字','奶娃','角色','字幕','待核实')
        self.assertTrue(r['ok'])
        self.assertTrue(r['saved'])
        self.assertTrue((self.home/'meme-memory.sqlite3').exists())
        a=self.find('奶娃')['entries']
        self.assertEqual(len(a),1)
        self.assertEqual(a[0]['name'],'奶蛙')
        self.assertEqual(a[0]['sources'][0]['bvid'],self.bvid)
        self.assertIn('未识图',a[0]['visual_status'])
        out=subprocess.check_output([sys.executable,str(ROOT/'lib/meme-memory-admin.py'),str(self.home),'list','奶蛙'])
        rows=json.loads(out)
        self.assertEqual(rows['entries'][0]['name'],'奶蛙')
        self.assertEqual(rows['total'],1)

    def test_same_name_new_video_adds_evidence_without_overwriting_meaning(self):
        self.save('奶蛙','一开始还不确定是什么',self.bvid,'标题里有奶蛙',evidence_type='标题',confidence='有文字依据')
        self.save('奶蛙','声称可爱外形（未被验证）','BV1sTHP66E5j','评论区又出现奶蛙',evidence_type='评论')
        entry=self.find('奶蛙')['entries'][0]
        self.assertEqual(entry['meaning'],'一开始还不确定是什么')
        self.assertEqual(entry['confidence'],'待核实')
        self.assertEqual(len(entry['sources']),2)
        self.assertEqual(self.find()['count'],1)

    def test_storage_capacity_does_not_delete_existing_or_block_source_updates(self):
        with patch.dict(os.environ, {'BILI_MEME_MAX_ENTRIES':'10'}):
            for i in range(10):
                res=self.save(f'新梗{i:02d}','有字幕记录',self.bvid,'视频字幕里有梗')
                self.assertTrue(res['saved'])
            r=self.save('第十一条梗','有字幕记录',self.bvid,'有证据')
            self.assertFalse(r['ok'])
            self.assertEqual(r['status'],'capacity_reached')
            self.assertEqual(self.find()['count'],10)
            r=self.save('新梗00','应该不覆盖原文','BV1sTHP66E5j','另一个视频的证据')
            self.assertTrue(r['ok'])
            self.assertEqual(len(self.find('新梗00')['entries'][0]['sources']),2)
        with patch.dict(os.environ, {'BILI_MEME_MAX_ENTRIES':'15'}):
            self.assertTrue(self.save('第十一条梗','有字幕记录',self.bvid,'有证据')['ok'])
        self.assertEqual(self.find()['count'],11)
        with patch.dict(os.environ, {'BILI_MEME_MAX_ENTRIES':'10'}):
            self.assertEqual(self.find()['count'],11)
            self.assertFalse(self.save('第十二条梗','有字幕记录',self.bvid,'有证据')['ok'])

    def test_bad_bv_secret_and_empty_evidence_rejected(self):
        for args in [
            ('奶蛙','一段解释','BVbad','字幕：奶蛙'),
            ('奶蛙','cookie=secret',self.bvid,'字幕：奶蛙'),
            ('奶蛙','一段解释',self.bvid,'https://example.com/secret'),
            ('奶蛙','一段解释',self.bvid,''),
            ('奶蛙','C:\\Users\\someone',self.bvid,'字幕：奶蛙')]:
            with self.assertRaises(ValueError): self.save(*args)
        self.assertFalse((self.home/'meme-memory.sqlite3').exists())

    def test_literal_search_and_delete(self):
        self.save('二创梗','啥都可能会出现',self.bvid,'字幕解释了二创梗')
        self.assertEqual(self.find('%')['entries'],[])
        ident=self.find('二创')['entries'][0]['id']
        out=subprocess.check_output([sys.executable,str(ROOT/'lib/meme-memory-admin.py'),str(self.home),'delete',str(ident)])
        self.assertTrue(json.loads(out)['deleted'])
        self.assertEqual(self.find()['count'],0)

    def test_missing_database_list_is_safe(self):
        out=subprocess.check_output([sys.executable,str(ROOT/'lib/meme-memory-admin.py'),str(self.home),'list',''])
        self.assertEqual(json.loads(out)['total'],0)
        self.assertFalse((self.home/'meme-memory.sqlite3').exists())

if __name__=='__main__': unittest.main()
