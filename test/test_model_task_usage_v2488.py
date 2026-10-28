"""Cross-process telemetry does not depend on live DSH/Bilibili credentials."""
import ast
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def _vision():
    spec=importlib.util.spec_from_file_location('dafeiyu_vision_usage',ROOT/'lib'/'vision_dsh.py')
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_vision_records_one_task_launch_without_prompts(tmp_path):
    mod=_vision()
    mod._record_model_launch(tmp_path,'vision')
    files=list((tmp_path/'model-usage').glob('*.jsonl'))
    assert len(files)==1
    data=json.loads(files[0].read_text(encoding='utf8').strip())
    assert data['task']=='vision'
    assert len(data['day'])==10
    assert data['at']
    assert 'prompt' not in data


def test_mcp_memory_uses_compatible_append_only_record_format(tmp_path):
    # Avoid importing the full MCP dependency graph; run only the audited helper AST.
    source=(ROOT/'vendor'/'bilibili-mcp'/'mcp_server.py').read_text(encoding='utf8')
    tree=ast.parse(source)
    helper=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_record_model_launch')
    from datetime import datetime
    import os
    code=compile(ast.Module(body=[helper],type_ignores=[]),'<test-helper>','exec')
    ns={'Path':Path,'datetime':datetime,'os':os,'json':json}
    exec(code,ns)
    ns['_record_model_launch'](tmp_path,'memory')
    files=list((tmp_path/'model-usage').glob('*.jsonl'))
    assert len(files)==1
    data=json.loads(files[0].read_text(encoding='utf8').strip())
    assert data['task']=='memory'
    assert data['day']
    assert 'prompt' not in data
