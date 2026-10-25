import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('video_wishes',ROOT/'vendor/bilibili-mcp/video_wishes.py')
mod=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(mod)

class WishTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.wid='01234567-89ab-4cde-aaaa-0123456789ab'
        self.person={'approval':{'status':'approved'},'videoWishes':[{'id':self.wid,'uid':'123',
            'topic':'美食','status':'active','limit':2,'expiresAt':9999999999999}]}
        self.save()
    def save(self):
        (self.root/'dm-autoreply-state.json').write_text(json.dumps({'people':{'123':self.person}}),encoding='utf-8')
    def test_metadata_verification(self):
        self.assertTrue(mod.verified_topic('美食','挑战吃遍火锅店'))
        self.assertFalse(mod.verified_topic('美食','高数考试与复结构'))
        self.assertFalse(mod.verified_topic('未知','美食'))
    def test_claim_cap_and_duplicate_bvid_and_acceptance(self):
        self.assertIsNone(mod.claim_wish(self.root,self.wid,'bad'))
        f=mod.claim_wish(self.root,self.wid,'BV1234567890');self.assertIsNotNone(f)
        self.assertIsNone(mod.claim_wish(self.root,self.wid,'BV1234567890'))
        mod.finish_claim(f,accepted=True,rpid='123456789')
        self.assertEqual(json.loads(f.read_text())['status'],'accepted')
        f2=mod.claim_wish(self.root,self.wid,'BV0987654321');self.assertIsNotNone(f2)
        self.assertIsNone(mod.claim_wish(self.root,self.wid,'BV1111111111'))
        mod.finish_claim(f2,accepted=False)
        self.assertEqual(json.loads(f2.read_text())['status'],'uncertain')
    def test_revocation_and_expiration_block(self):
        self.person['approval']['status']='rejected';self.save()
        self.assertIsNone(mod.claim_wish(self.root,self.wid,'BV1234567890'))
        self.person['approval']['status']='approved';self.person['videoWishes'][0]['expiresAt']=1;self.save()
        self.assertIsNone(mod.claim_wish(self.root,self.wid,'BV1234567890'))
    def test_does_not_spend_on_failed_lookup(self):
        self.assertIsNone(mod.get_approved_wish(self.root,'../../something'))
        self.assertEqual(list((self.root/'video-wish-claims').glob('*.json')) if (self.root/'video-wish-claims').exists() else [],[])

if __name__=='__main__':unittest.main()
