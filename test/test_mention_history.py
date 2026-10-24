"""不联网验证 @ 诊断持久化、日志隐私、发送结果/计数语义。"""
import ast
import json
import re
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'vendor/bilibili-mcp/mcp_server.py').read_text(encoding='utf8')
parsed = ast.parse(source)
names = {'_record_mention_event', '_comment_result', '_append_home', '_valid_bv', '_safe_line'}
code = compile(ast.Module(body=[node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in names],type_ignores=[]), '<mention_history>', 'exec')

class MentionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.home = Path(self.dir.name)
        self.scope = {'datetime':datetime,'json':json,'os':__import__('os'),'sys':sys, 'Path':Path,'re':re,
                      '_DUTY_HOME':self.home,'_BV_PATTERN':re.compile(r'^BV[0-9A-Za-z]{10}$')}
        exec(code, self.scope)
        self.diag = {'reason':'ai_declined','mode':'ai_select','selected_count':0,'configured_count':2}
        self.bvid = 'BV1pXHK6mE6z'

    def tearDown(self):
        self.dir.cleanup()

    def lines(self):
        files=list((self.home/'mention-diagnostics').glob('*.jsonl'))
        self.assertEqual(len(files),1)
        return [json.loads(s) for s in files[0].read_text(encoding='utf8').splitlines()]

    def test_success_without_mentions_saves_to_disk_and_duty_log(self):
        payload={'success':True,'rpid':123,'mention_delivery':'none','dynamic_sync':{'status':'disabled'}}
        returned=self.scope['_comment_result'](payload,self.bvid,0,self.diag)
        self.assertEqual(json.loads(returned),payload)
        self.assertNotIn('mention_diagnostic',returned)
        rec=self.lines()[0]
        self.assertTrue(rec['success'])
        self.assertFalse(rec['mention_attempted'])
        self.assertEqual(rec['rpid'],'123')
        self.assertEqual(rec['reason'],'ai_declined')
        self.assertEqual(rec['kind'],'top')
        self.assertIn('原因=ai_declined',(self.home/'duty.log').read_text(encoding='utf8'))

    def test_success_with_uid_mapping_is_attempt_not_verified(self):
        diag={**self.diag,'reason':'mention_requested','selected_count':1}
        self.scope['_comment_result']({'success':True,'rpid_str':'888','mention_delivery':'uid_mapping_submitted_unverified'},self.bvid,0,diag)
        rec=self.lines()[0]
        self.assertTrue(rec['mention_attempted'])
        self.assertFalse(rec['notice_confirmed'])
        self.assertEqual(rec['selected_count'],1)
        self.assertEqual(rec['rpid'],'888')

    def test_text_only_without_uid_is_not_delivery_confirmation(self):
        diag={**self.diag,'reason':'mentioned_text_only_missing_uid','selected_count':1}
        self.scope['_comment_result']({'success':True,'rpid':777,'mention_delivery':'text_only_unverified'},self.bvid,0,diag)
        rec=self.lines()[0]
        self.assertTrue(rec['mention_attempted'])
        self.assertFalse(rec['notice_confirmed'])
        self.assertEqual(rec['reason'],'mentioned_text_only_missing_uid')

    def test_failed_send_separate_from_success(self):
        self.scope['_comment_result']({'success':False,'error':'风控拒绝\nCookie私密信息', 'mention_delivery':'not_sent'},self.bvid,0,self.diag)
        rec=self.lines()[0]
        self.assertFalse(rec['success'])
        self.assertFalse(rec['mention_attempted'])
        self.assertEqual(rec['error'],'评论未成功（详细原因见工具回执）')
        self.assertNotIn('Cookie私密信息', json.dumps(rec,ensure_ascii=False))

    def test_replies_not_group_mentioned(self):
        diag={**self.diag,'reason':'reply_no_group_mentions'}
        self.scope['_comment_result']({'success':True,'rpid':456,'mention_delivery':'none'},self.bvid,3344,diag)
        self.assertEqual(self.lines()[0]['kind'],'reply')

    def test_comment_text_and_uid_not_persisted(self):
        p={'success':True,'rpid':456,'mention_delivery':'none','private_note':'private content'}
        self.scope['_comment_result'](p,self.bvid,0,self.diag)
        txt=(self.home/'duty.log').read_text('utf8')+self.lines()[0].__str__()
        self.assertNotIn('private content',txt)

if __name__=='__main__':
    unittest.main()
