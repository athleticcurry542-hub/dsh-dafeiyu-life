"""No-network tests for the main-Session explicit like action."""
import ast, asyncio, json, os, re, sqlite3, tempfile, unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'vendor/bilibili-mcp/mcp_server.py').read_text('utf8')
NAMES={'_action_conn','_claim_video_action','_finish_video_action','bili_video_like_manual'}
TREE=ast.parse(SOURCE); BODY=[]
for node in TREE.body:
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NAMES:
        node.decorator_list=[]; BODY.append(node)
COMPILED=compile(ast.fix_missing_locations(ast.Module(body=BODY,type_ignores=[])),'<manual-like>','exec')
BV='BV1pXHK6mE6z'

class DummyVideo:
    likes=[]
    def __init__(self,bvid,credential): self.bvid=bvid
    async def like(self,status): self.likes.append((self.bvid,status))

class ManualLikeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.home=Path(self.tmp.name)
        DummyVideo.likes=[]
        self.env=patch.dict(os.environ,{'BILI_SESSION_MANUAL_LIKE_ENABLED':'1','BILI_AUTO_VIDEO_LIKE_DAILY_LIMIT':'2'})
        self.env.start();self.addCleanup(self.env.stop)
        self.scope={'sqlite3':sqlite3,'re':re,'os':os,'json':json,'datetime':datetime,'Path':Path,
            '_DUTY_HOME':self.home,'_ACTION_DB_NAME':'video-actions.sqlite3',
            'get_cred':lambda:SimpleNamespace(dedeuserid='1234'),
            '_valid_bv':lambda x: x if re.fullmatch(r'BV[0-9A-Za-z]{10}',x) else (_ for _ in()).throw(ValueError('BV号格式错误')),
            '_safe_line':lambda x,n=100:str(x or '').replace('\n',' ')[:n],
            '_guard':lambda name:'','video':SimpleNamespace(Video=DummyVideo)}
        exec(COMPILED,self.scope)
    def call(self,bv=BV,reason='主人明确要求点赞'):
        return json.loads(asyncio.run(self.scope['bili_video_like_manual'](bv,reason)))
    def test_manual_like_does_not_require_today_picked_ledger(self):
        result=self.call()
        self.assertTrue(result['ok']);self.assertTrue(result['liked']);self.assertEqual(result['bvid'],BV)
        self.assertEqual(DummyVideo.likes,[(BV,True)])
    def test_duplicate_is_blocked_and_manual_shares_daily_quota(self):
        self.assertTrue(self.call(BV)['ok'])
        self.assertFalse(self.call(BV)['ok'])
        self.assertTrue(self.call('BV1sTHP66E5j')['ok'])
        self.assertFalse(self.call('BV1xxxxxxxxx')['ok'])
        self.assertEqual(len(DummyVideo.likes),2)
    def test_disabled_endpoint_and_zero_quota_do_not_like(self):
        with patch.dict(os.environ,{'BILI_SESSION_MANUAL_LIKE_ENABLED':'0'}):
            self.assertFalse(self.call()['ok'])
        with patch.dict(os.environ,{'BILI_AUTO_VIDEO_LIKE_DAILY_LIMIT':'0'}):
            self.assertFalse(self.call('BV1sTHP66E5j')['ok'])
        self.assertEqual(DummyVideo.likes,[])
    def test_invalid_bv_and_unknown_uid_do_not_like(self):
        self.assertFalse(self.call('bad')['ok'])
        self.scope['get_cred']=lambda:SimpleNamespace(dedeuserid='')
        self.assertFalse(self.call('BV1sTHP66E5j')['ok'])
        self.assertEqual(DummyVideo.likes,[])

if __name__=='__main__':unittest.main()
