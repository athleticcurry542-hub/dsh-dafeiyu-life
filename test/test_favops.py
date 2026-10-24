"""Tests for the favorite sidecar using a fake SDK; no Bilibili credentials/network needed."""
import asyncio
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('favops_under_test', ROOT / 'lib' / 'favops.py')
favops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(favops)


class FavoriteOpsTests(unittest.TestCase):
    def run_add(self, fake_result=None, error=None):
        calls = []

        class FakeVideo:
            def __init__(self, bvid, credential):
                calls.append(('init', bvid, credential))

            async def set_favorite(self, *, add_media_ids):
                calls.append(('set_favorite', add_media_ids))
                if error:
                    raise error
                return fake_result

        pkg = types.ModuleType('bilibili_api')
        pkg.video = types.SimpleNamespace(Video=FakeVideo)
        out = io.StringIO()
        with patch.dict(sys.modules, {'bilibili_api': pkg}), patch.object(favops, 'load', return_value=('credential', 123)), contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit):
                asyncio.run(favops.add('BV1c8nK6zEGV', 987654))
        return json.loads(out.getvalue().strip()), calls

    def test_uses_supported_video_set_favorite(self):
        response, calls = self.run_add({'success_num': 1})
        self.assertTrue(response['ok'])
        self.assertIn(('set_favorite', [987654]), calls)

    def test_sdk_api_error_is_visible(self):
        response, _ = self.run_add({'code': -101, 'message': '未登录'})
        self.assertFalse(response['ok'])
        self.assertIn('未登录', response['error'])

    def test_sdk_exception_is_visible(self):
        response, _ = self.run_add(error=RuntimeError('csrf 校验失败'))
        self.assertFalse(response['ok'])
        self.assertIn('csrf', response['error'])

    def test_already_favorite_is_not_retried(self):
        response, _ = self.run_add(error=RuntimeError('视频已经收藏'))
        self.assertEqual(response, {'ok': True, 'already': True})

    def test_invalid_bvid_stops_before_creating_client(self):
        pkg = types.ModuleType('bilibili_api')
        pkg.video = types.SimpleNamespace(Video=lambda **kwargs: self.fail('SDK should not be called'))
        out = io.StringIO()
        with patch.dict(sys.modules, {'bilibili_api': pkg}), contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit):
                asyncio.run(favops.add('not-a-BV', 123))
        self.assertFalse(json.loads(out.getvalue())['ok'])


if __name__ == '__main__':
    unittest.main()
