import json
import tempfile
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'vendor'/'bilibili-mcp'))
from comment_meme_search import search_library, load_rules

class TestUserEditableMemeRules(unittest.TestCase):
    def setUp(self):
        self.home=tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.homepath=Path(self.home.name)
        self.lib=self.homepath/'comment-memes'
        for item in ('饭/大米饭','动作/战斗机','奶蛙/大笑','情绪/鼓掌'):
            f=self.lib/(item+'.webp')
            f.parent.mkdir(parents=True,exist_ok=True)
            f.write_bytes(b'fake')

    def write(self, rules):
        (self.homepath/'comment-meme-rules.json').write_text(json.dumps({'schema':1,'rules':rules},ensure_ascii=False),encoding='utf8')

    def test_default_and_fridge_combo(self):
        rules=load_rules(self.homepath)
        self.assertGreaterEqual(len(rules),8)
        self.assertEqual(search_library(self.homepath,'我把冰箱搬走了')['matches'],[])
        self.assertEqual(search_library(self.homepath,'冰箱里还有白饭')['matches'][0]['name'],'饭/大米饭')
        self.assertEqual(search_library(self.homepath,'哈哈哈')['matches'][0]['name'],'奶蛙/大笑')

    def test_custom_rule_governs_search_and_require_and_exclude(self):
        self.write([{'id':'custom','label':'主人专用鼓掌','enabled':True,
                     'triggers':['牛啊'],'targets':['鼓掌'],'requireAny':['真厉害'],'excludeAny':['讽刺']}])
        self.assertEqual(search_library(self.homepath,'牛啊真厉害')['matches'][0]['name'],'情绪/鼓掌')
        self.assertEqual(search_library(self.homepath,'牛啊')['matches'],[])
        self.assertEqual(search_library(self.homepath,'牛啊真厉害讽刺')['matches'],[])
        self.assertEqual(search_library(self.homepath,'哈哈哈')['matches'],[])
        r=load_rules(self.homepath);r[0]['enabled']=False;self.write(r)
        self.assertEqual(search_library(self.homepath,'牛啊真厉害')['matches'],[])

    def test_malformed_custom_rule_no_silent_fallback(self):
        (self.homepath/'comment-meme-rules.json').write_text('{not json',encoding='utf8')
        with self.assertRaises(ValueError):
            load_rules(self.homepath)

if __name__=='__main__': unittest.main()
