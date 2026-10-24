import importlib.util
from pathlib import Path
import re
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('hr', ROOT/'vendor'/'bilibili-mcp'/'home_recommendations.py')
hr=importlib.util.module_from_spec(spec)
spec.loader.exec_module(hr)

class HomepageRecommendationsTests(unittest.TestCase):
    @staticmethod
    def _item(bv='BV1234567890', **updates):
        item={'bvid':bv,'goto':'av','title':'路过一只奶蛙',
              'owner':{'name':'up'},'stat':{'view':200,'reply':9,'danmaku':3},
              'duration':123}
        item.update(updates)
        return item

    def test_filter_only_videos_dedupe_and_sanitize(self):
        items=[self._item(),self._item(),
               self._item('BV1234567891',goto='live'),
               self._item('BV1234567892',is_ad=True),
               self._item('BV1234567893',business_info={'ads':'sponsored'}),
               self._item('BV1234567894',title='<b>第二条</b>'),
               self._item('../bad')]
        videos=hr.normalize_recommendations({'item':items})
        self.assertEqual(len(videos),2)
        self.assertEqual(videos[0]['bvid'],'BV1234567890')
        self.assertEqual(videos[1]['title'],'第二条')
        self.assertEqual(videos[0]['play'],200)
        self.assertEqual(videos[0]['source'],'homepage_recommend')

    def test_count_is_bounded_even_for_big_api_result(self):
        items=[self._item('BV'+str(i).zfill(10)) for i in range(100)]
        self.assertEqual(len(hr.normalize_recommendations(items)),12)

    def test_signed_wbi_first(self):
        nav={'wbi_img':{'img_url':'https://i0.hdslb.com/bfs/wbi/'+'a'*32+'.png',
                        'sub_url':'https://i0.hdslb.com/bfs/wbi/'+'b'*32+'.png'}}
        calls=[]
        def fake(path,params,cred):
            calls.append((path,params))
            self.assertEqual(cred,'token-for-test')
            if path.endswith('/nav'): return nav
            if '/wbi/' in path:
                self.assertTrue(re.fullmatch(r'[0-9a-f]{32}',params.get('w_rid','')))
                return {'item':[self._item()]}
            self.fail('should not use legacy endpoint')
        result=hr.get_home_recommendations('token-for-test',fetch=fake)
        self.assertTrue(result['ok']);self.assertEqual(result['count'],1)
        self.assertEqual(result['api'],'wbi_home_feed')
        self.assertEqual(len(calls),2)

    def test_fallback_to_legacy_only_once(self):
        calls=[]
        def fake(path,params,cred):
            calls.append(path)
            if path.endswith('/nav'): raise ValueError('blocked')
            self.assertEqual(path,'/x/web-interface/index/top/rcmd')
            return [self._item()]
        result=hr.get_home_recommendations('x',fetch=fake)
        self.assertEqual(result['api'],'legacy_home_feed')
        self.assertEqual(len(calls),2)

    def test_both_fail_returns_soft_unavailable_without_leaking_token(self):
        def fail(*args): raise ValueError('bad cookie')
        result=hr.get_home_recommendations('secret_cookie',fetch=fail)
        self.assertFalse(result['ok']);self.assertEqual(result['status'],'unavailable')
        self.assertNotIn('secret_cookie',str(result))

    def test_redirects_forbidden_and_fixed_endpoint(self):
        self.assertIsNone(hr._NoRedirect().redirect_request(None,None,None,None,None,None,None))
        with self.assertRaises(ValueError):
            hr._api_get('/evil',{},'sess')

if __name__=='__main__':unittest.main()
