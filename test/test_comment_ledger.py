"""真实执行 Python 发送成功出口的本地自动写账功能；不接网络、不发布评论。"""
import ast
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest

FILE = Path(__file__).resolve().parents[1]/'vendor/bilibili-mcp/mcp_server.py'
NAMES = {'_record_comment_in_ledger', '_comment_result', '_record_mention_event', '_append_home', '_read_home', '_safe_line', '_valid_bv'}
TREE = ast.parse(FILE.read_text('utf-8'))
CODE = compile(ast.Module(body=[node for node in TREE.body if isinstance(node,ast.FunctionDef) and node.name in NAMES],type_ignores=[]),str(FILE),'exec')

class CommentLedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.scope = {'datetime':datetime,'json':json,'os':os,'re':re,'sys':sys,'Path':Path,'_DUTY_HOME':self.home,
                      '_BV_PATTERN':re.compile(r'^BV[0-9A-Za-z]{10}$')}
        exec(CODE, self.scope)
        self.write = self.scope['_record_comment_in_ledger']
    def tearDown(self): self.tmp.cleanup()
    def text(self): return (self.home/'seen.md').read_text('utf-8') if (self.home/'seen.md').exists() else ''
    def test_success_automatically_logged_and_deduped(self):
        b='BV1234567890'
        receipt={'success':True,'rpid':'318765432101'}
        self.write(receipt,b,0,'一句评论|带竖线\n防注入')
        self.write(receipt,b,0,'重复调用')
        self.assertEqual(self.text().count('318765432101'),1)
        self.assertIn('一句评论／带竖线 防注入',self.text())
        self.assertIn('## 评论记录（发送工具自动写入',self.text())
    def test_reply_preserves_root_and_top_has_zero(self):
        self.write({'success':True,'rpid_str':'318765432102'},'BV1234567891',123456789012,'后台回复',987654321098)
        self.write({'success':True,'rpid_str':'318765432103'},'BV1234567892',0,'顶层原创')
        self.assertIn('| BV1234567891 | 318765432102 | 987654321098 |',self.text())
        self.assertIn('| BV1234567892 | 318765432103 | 0 |',self.text())
    def test_failure_never_enters_ledger(self):
        self.write({'success':False,'rpid':'318765432104'},'BV1234567890',0,'未发送')
        self.write({'success':'true','rpid':'318765432105'},'BV1234567890',0,'未确认')
        self.assertEqual(self.text(),'')
    def test_missing_id_is_explicit(self):
        self.write({'success':True},'BV1234567890',0,'成功但没回评论ID')
        self.assertIn('| BV1234567890 | ? | 0 |',self.text())
        self.assertIn('[成功回执·无评论ID]',self.text())
    def test_comment_result_calls_ledger_even_without_mention_diagnostic(self):
        out=self.scope['_comment_result']({'success':True,'rpid':'318765432106'},'BV1234567893',0,None,'这次评论')
        self.assertTrue(json.loads(out)['success'])
        self.assertIn('| BV1234567893 | 318765432106 |',self.text())
        self.assertFalse((self.home/'mention-diagnostics').exists())
    def test_invalid_bvid_does_not_leak_into_ledger(self):
        self.write({'success':True,'rpid':'318765432107'},'../credential.json',0,'非法')
        self.assertEqual(self.text(),'')

if __name__=='__main__': unittest.main()
