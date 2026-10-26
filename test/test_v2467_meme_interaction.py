"""Interactive meme snapshot must honor approval, include manual additions, and never leak rejected records."""
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / 'lib' / 'meme-memory-admin.py'


class ReplyMemeSnapshotTest(unittest.TestCase):
    def test_snapshot_reads_only_approved_records(self):
        with tempfile.TemporaryDirectory() as home:
            db = Path(home) / 'meme-memory.sqlite3'
            conn = sqlite3.connect(db)
            conn.executescript('''
                CREATE TABLE memes(id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT, aliases TEXT,
                    kind TEXT, meaning TEXT, confidence TEXT, updated_at TEXT, review_status TEXT);
                CREATE TABLE meme_sources(meme_id INTEGER, bvid TEXT, evidence_type TEXT,
                    evidence TEXT, noted_at TEXT);
            ''')
            conn.executemany('''INSERT INTO memes VALUES(?,?,?,?,?,?,?,?,?)''', [
                (1, '鱼来', '鱼来', '牛来,召唤大肥鱼', '梗', '在评论区召唤大肥鱼', '有文字依据', 'now', 'approved'),
                (2, 'fail', '未批准', '', '梗', '猜测', '待核实', 'now', 'pending'),
                (3, 'no', '已拒绝', '', '梗', '错梗', '有文字依据', 'now', 'rejected'),
            ])
            conn.commit()
            conn.close()
            output=subprocess.run([sys.executable,str(SCRIPT),home,'interaction',''],
                check=True,capture_output=True,text=True)
            data=json.loads(output.stdout)
            self.assertTrue(data['ok'])
            self.assertEqual(len(data['entries']),1)
            self.assertEqual(data['entries'][0]['name'],'鱼来')
            self.assertEqual(data['entries'][0]['aliases'],'牛来,召唤大肥鱼')
            self.assertEqual(data['entries'][0]['meaning'],'在评论区召唤大肥鱼')

    def test_no_db_does_not_create_database(self):
        with tempfile.TemporaryDirectory() as home:
            output=subprocess.run([sys.executable,str(SCRIPT),home,'interaction',''],
                check=True,capture_output=True,text=True)
            self.assertFalse((Path(home)/'meme-memory.sqlite3').exists())
            self.assertEqual(json.loads(output.stdout).get('ok'),False)


if __name__=='__main__': unittest.main()
