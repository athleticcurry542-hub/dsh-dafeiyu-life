"""Read-only, bounded local preview; used by the owner UI, never sends a comment."""
import json
import sys
from pathlib import Path
home=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(home))
sys.path.insert(1,str(Path(__file__).resolve().parent.parent/'vendor'/'bilibili-mcp'))
try:
    from comment_meme_search import search_library
    print(json.dumps(search_library(home,sys.argv[2],limit=12),ensure_ascii=False))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)[:180]},ensure_ascii=False))
