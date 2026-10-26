"""Regression: Claude, Anthropic, Opus and 说中文 should find real image names.
Previews must use unsaved editor rules without replacing persisted configuration.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE/'vendor'/'bilibili-mcp'))
from comment_meme_search import search_library

class MemeRulePreview(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='v2473-preview-')
        self.home=Path(self.temp.name)
        self.folder=self.home/'comment-memes'/'大肥鱼和其他大模型'
        self.folder.mkdir(parents=True)
        self.files=[
           'Claude娘『说中文？你号没了』表情包',
           'DeepSeek娘『去找你的Opus啊』表情包',
           'DeepSeek娘『说中文？你号没了！』表情包',
        ]
        for n in self.files:
           (self.folder/(n+'.png')).write_bytes(b'fake-image')
        self.rule={"id":"claude","label":"Claude／Opus梗","enabled":True,
            "triggers":["Claude","Opus","Anthropic"],
            "targets":["Claude娘","去找你的Opus","说中文？你号没了"],
            "requireAny":[],"excludeAny":[]}
        # Saved version intentionally has an unrelated, nonmatching rule:
        self.saved={'schema':1,'rules':[{'id':'other','label':'不关联',
            'enabled':True,'triggers':['冰箱'],'targets':['冰箱'],
            'requireAny':[],'excludeAny':[]}]}
        (self.home/'comment-meme-rules.json').write_text(json.dumps(self.saved),encoding='utf8')
    def tearDown(self): self.temp.cleanup()
    def test_unsaved_editor_preview_and_persistence_isolation(self):
        script=BASE/'lib'/'comment-meme-rule-preview.py'
        changed={'schema':1,'rules':[self.rule]}
        for query in ['Claude','Anthropic','Opus','说中文','Claude说中文']:
            with self.subTest(query=query):
                p=subprocess.run([sys.executable,str(script),str(self.home),query],
                    input=json.dumps(changed,ensure_ascii=False),encoding='utf8',capture_output=True,check=True)
                output=json.loads(p.stdout)
                self.assertTrue(output['ok'],output)
                self.assertEqual(output['total'],3)
                self.assertTrue(any('说中文' in r['name'] for r in output['matches']),output)
        self.assertEqual(json.loads((self.home/'comment-meme-rules.json').read_text()),self.saved)
        self.assertFalse(search_library(self.home,'Anthropic')['matches'])
        self.assertTrue(search_library(self.home,'Anthropic',rules_override=changed)['matchedRules'])
    def test_missing_library_will_report_rule_but_no_image(self):
        for n in self.files: (self.folder/(n+'.png')).unlink()
        result=search_library(self.home,'Anthropic',rules_override={'schema':1,'rules':[self.rule]})
        self.assertEqual(result['total'],0)
        self.assertEqual(result['matches'],[])
        self.assertEqual(result['matchedRules'][0]['label'],'Claude／Opus梗')
    def test_invalid_override_rejected(self):
        with self.assertRaisesRegex(ValueError,'格式'):
            search_library(self.home,'Claude',rules_override={'schema':5,'rules':[self.rule]})

if __name__=='__main__':unittest.main()
