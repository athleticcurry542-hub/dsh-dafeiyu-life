import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('preview_vision_fix', ROOT/'lib'/'preview_vision.py')
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Http403Tests(unittest.TestCase):
    def test_image_rejection_reports_cdn_not_local_host(self):
        err=HTTPError('https://i0.hdslb.com/bfs/videoshot/1.jpg',403,'Forbidden',{},None)
        with patch.object(mod.urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=err
            with self.assertRaisesRegex(ValueError, 'B站预览图片 CDN 返回 HTTP 403'):
                mod._safe_api_get('http://i0.hdslb.com/bfs/videoshot/1.jpg', image=True)
            args=opener.return_value.open.call_args
            self.assertEqual(args.args[0].full_url,'https://i0.hdslb.com/bfs/videoshot/1.jpg')
    def test_api_rejection_reports_api(self):
        err=HTTPError('https://api.bilibili.com/x/player/videoshot',403,'Forbidden',{},None)
        with patch.object(mod.urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=err
            with self.assertRaisesRegex(ValueError, 'B站视频/快照接口 返回 HTTP 403'):
                mod._safe_api_get('https://api.bilibili.com/x/player/videoshot')
    def test_unknown_external_host_still_blocked(self):
        with self.assertRaises(ValueError):
            mod._safe_api_get('http://attacker.example/bfs/videoshot/1.jpg',image=True)
        with self.assertRaises(ValueError):
            mod._safe_api_get('https://i0.hdslb.com/admin/secrets.jpg',image=True)

if __name__=='__main__': unittest.main()
