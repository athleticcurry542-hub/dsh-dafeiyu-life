import ast
import datetime
import json
import re
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'vendor/bilibili-mcp/mcp_server.py'
TREE=ast.parse(SOURCE.read_text(encoding='utf8'))
NAMES={'_record_comment_meme_event', '_public_no_mention_reason'}
MINI=ast.Module(body=[x for x in TREE.body if isinstance(x,ast.FunctionDef) and x.name in NAMES],type_ignores=[])

class MemeDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)
        self.scope={'datetime':datetime.datetime,'json':json,'re':re,'sys':__import__('sys'),
                    '_valid_bv':lambda bv: bv if re.fullmatch(r'BV[0-9A-Za-z]{10}',bv) else (_ for _ in ()).throw(ValueError('bad bv'))}
        def append(rel,text):
            path=self.home/rel
            path.parent.mkdir(parents=True,exist_ok=True)
            with path.open('a',encoding='utf8') as f: f.write(text)
        self.scope['_append_home']=append
        exec(compile(MINI,'meme-test','exec'),self.scope)
        self.bvid='BV1234567890'
    def events(self):
        files=list((self.home/'comment-meme-diagnostics').glob('*.jsonl'))
        return [json.loads(line) for f in files for line in f.read_text(encoding='utf8').splitlines()]
    def test_no_image_reason_is_persisted_without_comment_body(self):
        self.scope['_record_comment_meme_event']({'success':True,'rpid':234,'text':'private-should-not-save'},self.bvid,0,
            {'enabled':True,'name':'','reason':'本条只是科普讲解，没有合适梗图'})
        [event]=self.events()
        self.assertEqual(event['status'],'ai_skipped')
        self.assertEqual(event['ai_reason'],'本条只是科普讲解，没有合适梗图')
        self.assertFalse(event['upload_attempted'])
        self.assertNotIn('private-should-not-save',(self.home/'duty.log').read_text(encoding='utf8'))
    def test_image_uploaded_is_not_claimed_to_be_visible(self):
        self.scope['_record_comment_meme_event']({'success':True,'rpid':789,'meme_image':{'status':'submitted_unverified'}},
            self.bvid,0,{'enabled':True,'name':'奶娃/奶龙大笑','reason':'反转很好笑'})
        [event]=self.events()
        self.assertEqual(event['status'],'submitted_unverified')
        self.assertEqual(event['image'],'奶娃/奶龙大笑')
        self.assertFalse(event['image_visible_confirmed'])
        self.assertTrue(event['upload_attempted'])
    def test_failed_attempt_distinguished_from_success(self):
        self.scope['_record_comment_meme_event']({'success':False,'meme_image':{'status':'uncertain_no_retry'}},
            self.bvid,0,{'enabled':True,'name':'奶娃/大笑','reason':'很有趣'})
        [event]=self.events()
        self.assertFalse(event['success'])
        self.assertTrue(event['upload_attempted'])
        self.assertEqual(event['status'],'uncertain_no_retry')
    def test_reply_not_in_top_level_diagnostics(self):
        self.scope['_record_comment_meme_event']({'success':True,'rpid':987},self.bvid,234,
            {'enabled':True,'name':'','reason':'无需梗图'})
        self.assertFalse((self.home/'comment-meme-diagnostics').exists())
    def test_untrusted_ai_reason_not_inserted_as_log_command(self):
        self.scope['_record_comment_meme_event']({'success':True,'rpid':444},self.bvid,0,
            {'enabled':True,'name':'','reason':'test\nCookie=SECRET'})
        [event]=self.events()
        self.assertEqual(event['ai_reason'],'')
        self.assertNotIn('SECRET',(self.home/'duty.log').read_text(encoding='utf8'))
