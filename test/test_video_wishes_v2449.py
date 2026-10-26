import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor' / 'bilibili-mcp'))
from video_wishes import verified_topic

class WishThemes(unittest.TestCase):
    def test_yanzhi_real_metadata(self):
        self.assertTrue(verified_topic('颜值', '美女小姐姐日常视频'))
        self.assertFalse(verified_topic('颜值', '科技资讯和笔记本评测'))
    def test_food_remains_available(self):
        self.assertTrue(verified_topic('美食', '给大家做一顿火锅'))

if __name__ == '__main__': unittest.main()
