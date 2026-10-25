import importlib.util
import json
from pathlib import Path

def test_manual_preview_logs_success_without_bytes(tmp_path,monkeypatch):
    root=Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('vp_events',root/'lib'/'preview_vision.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    def fake(*args,**kwargs):return {'ok':True,'status':'frames_ready','times':[10,70], 'debug_dir':str(tmp_path/'vision-debug'/'BV1234567890'), 'frames':[{'bytes':b'SECRET'}]}
    monkeypatch.setattr(mod,'_analyze_preview_core',fake)
    result=mod.analyze_preview('BV1234567890',tmp_path,return_frames=True)
    assert result['ok']
    path=next((tmp_path/'vision-events').glob('*.jsonl'))
    content=path.read_text('utf8'); event=json.loads(content)
    assert event['source']=='video_agent_frames';assert event['debug_saved']
    assert 'SECRET' not in content;assert 'bytes' not in content

def test_preview_failure_is_logged(tmp_path,monkeypatch):
    root=Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('vp_events2',root/'lib'/'preview_vision.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    monkeypatch.setattr(mod,'_analyze_preview_core',lambda *a,**k:{'ok':False,'error':'B站视频/快照接口返回 HTTP 403'})
    mod.analyze_preview('BV1234567890',tmp_path,prefetch_only=True)
    event=json.loads(next((tmp_path/'vision-events').glob('*.jsonl')).read_text('utf8'))
    assert event['status']=='preview_failed';assert '403' in event['error']
