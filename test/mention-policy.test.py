"""不依赖真实 B站凭证；只检查 Python MCP 的@策略函数。运行 python test/mention-policy.test.py"""
import ast
import json
import os
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
source = (ROOT / 'vendor' / 'bilibili-mcp' / 'mcp_server.py').read_text(encoding='utf8')
needed = {'_mention_settings', '_decorate_comment'}
parsed = ast.parse(source)
code = compile(ast.Module(body=[n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name in needed], type_ignores=[]), '<mention>', 'exec')
scope = {'os': os, 'json': json}
exec(code, scope)
settings, decorate = scope['_mention_settings'], scope['_decorate_comment']

class MentionTests(unittest.TestCase):
    def test_ai_explicit_choice(self):
        targets = [{'name': '长条动物', 'uid': '123'}, {'name': '小鲸鱼', 'uid': '456'}]
        self.assertEqual(decorate('好家伙', targets, False)[0], '好家伙')
        self.assertEqual(decorate('好家伙', targets, True)[0], '好家伙 @长条动物 @小鲸鱼')
        self.assertIn('！ @长条动物 @小鲸鱼 ', decorate('救命！这也太离谱了', targets, True, 'middle')[0])

    def test_headless_env_is_authoritative(self):
        with patch.dict(os.environ, {'BILI_MENTION_MODE': 'off', 'BILI_MENTION_TARGETS': '[{"name":"甲","uid":"12"}]'}):
            mode, people = settings('always', [{'name': '恶意指定', 'uid': '999'}])
        self.assertEqual(mode, 'off')
        self.assertEqual(people, [{'name': '甲', 'uid': '12'}])

    def test_missing_uid_no_pretend_verified(self):
        with patch.dict(os.environ, {}, clear=True):
            mode, people = settings('ai', [{'name': '甲', 'uid': ''}])
        self.assertEqual(people[0]['uid'], '')

if __name__ == '__main__':
    unittest.main()
