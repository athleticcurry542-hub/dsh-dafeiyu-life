import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'vendor'/'bilibili-mcp'))
sys.path.insert(0,str(ROOT/'lib'))
from comment_memes import _list
spec=importlib.util.spec_from_file_location("sticker_admin", ROOT/"lib"/"sticker-admin.py")
sticker_admin=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sticker_admin)

class StickerLongNameTest(unittest.TestCase):
    def test_long_image_name_is_searchable_and_manageable(self):
        with tempfile.TemporaryDirectory() as home:
            root=Path(home)
            folder=root/'comment-memes'/'大肥鱼和其他大模型'
            folder.mkdir(parents=True)
            stem='DeepSeek娘『'+('内容'*22)+'』表情包'
            self.assertGreater(len(stem),48)
            self.assertLessEqual(len(stem),64)
            (folder/(stem+'.png')).write_bytes(b'pretend-png')
            self.assertEqual(len(_list(root)),1)
            self.assertEqual(len(sticker_admin.scans(root/'comment-memes')),1)
            self.assertEqual(_list(root)[0]['name'],'大肥鱼和其他大模型/'+stem)

if __name__=='__main__': unittest.main()
