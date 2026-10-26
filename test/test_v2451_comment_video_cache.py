"""Unit test for the bounded video-evidence cache without needing live Bilibili login."""
import ast
import json
import os
import re
import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vendor' / 'bilibili-mcp' / 'mcp_server.py'

class VideoCacheTest(unittest.TestCase):
    def test_bounded_actual_evidence_and_safe_paths(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                  and node.name == '_remember_video_context')
        namespace = {'Path': Path, 'os': os, 're': re, 'json': json,
                     'datetime': datetime, 'uuid': uuid}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])),
                     str(SOURCE), 'exec'), namespace)
        write = namespace['_remember_video_context']
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get('BILI_DUTY_HOME')
            os.environ['BILI_DUTY_HOME'] = directory
            try:
                bv = 'BV1ignA6REjB'
                write('../bad', 'info', {'title': 'bad'})
                write(bv, 'info', {'title': '标题', 'description': '实际简介'*900,
                                    'sessdata': 'SECRET_DO_NOT_SAVE'})
                write(bv, 'subtitle', {'text': '真实字幕'*700})
                write(bv, 'comments', {'comments': [{'rpid': i, 'content': '热门评论'*100}
                                                    for i in range(20)]})
                folder = Path(directory) / 'comment-video-context'
                files = list(folder.iterdir())
                self.assertEqual(len(files), 1)
                result = json.loads(files[0].read_text(encoding='utf-8'))
                self.assertEqual(result['info']['title'], '标题')
                self.assertLessEqual(len(result['info']['description']), 900)
                self.assertLessEqual(len(result['subtitle']['text']), 2000)
                self.assertEqual(len(result['comments']['items']), 12)
                self.assertNotIn('SECRET_DO_NOT_SAVE', json.dumps(result))
            finally:
                if previous is None:
                    os.environ.pop('BILI_DUTY_HOME', None)
                else:
                    os.environ['BILI_DUTY_HOME'] = previous

if __name__ == '__main__':
    unittest.main()
