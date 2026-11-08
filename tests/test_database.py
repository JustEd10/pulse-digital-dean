import os
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
from scripts.database import snapshot


class DatabaseTools(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.source=self.root/'live.sqlite3'
        with patch.object(server,'DB_PATH',self.source):
            server.init_db()

    def tearDown(self):
        self.tmp.cleanup()

    def test_online_backup_and_safe_restore(self):
        live=sqlite3.connect(str(self.source))
        try:
            live.execute('PRAGMA journal_mode=WAL')
            live.execute("INSERT INTO sessions VALUES ('hash',1,'csrf',9999999999)")
            live.execute("INSERT INTO requests VALUES ('backup-check',1,'study','Данные из WAL',2,'submitted','2026-11-07','test')")
            live.commit()
            backup=snapshot(self.source,self.root/'snapshot.sqlite3')
            restored=snapshot(backup,self.root/'restored.sqlite3',restore=True)
            with closing(sqlite3.connect(str(backup))) as db, db:
                self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],1)
            with closing(sqlite3.connect(str(restored))) as db, db:
                self.assertEqual(db.execute('SELECT purpose FROM requests WHERE id=?',('backup-check',)).fetchone()[0],'Данные из WAL')
                self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(live.execute('SELECT count(*) FROM sessions').fetchone()[0],1)
        finally:
            live.close()

    def test_refuses_overwrite_and_invalid_source(self):
        dest=self.root/'existing.sqlite3'
        dest.write_bytes(b'keep me')
        with self.assertRaises(ValueError):snapshot(self.source,dest)
        self.assertEqual(dest.read_bytes(),b'keep me')
        with self.assertRaises(ValueError):snapshot(self.source,self.source)
        invalid=self.root/'invalid.sqlite3'
        with closing(sqlite3.connect(str(invalid))) as db, db:db.execute('CREATE TABLE other (id)')
        with self.assertRaises(ValueError):snapshot(invalid,self.root/'bad.sqlite3')
        self.assertFalse((self.root/'bad.sqlite3').exists())
        self.assertEqual(list(self.root.glob('*.tmp')),[])

    def test_existing_parent_permissions_unchanged(self):
        if os.name!='nt':os.chmod(self.root,0o755)
        before=self.root.stat().st_mode & 0o777
        with patch.object(server,'DB_PATH',self.source):server.init_db()
        self.assertEqual(self.root.stat().st_mode & 0o777,before)
        if os.name!='nt':self.assertEqual(self.source.stat().st_mode & 0o777,0o600)

    def test_documented_cli(self):
        root=Path(__file__).resolve().parents[1]
        backup=self.root/'cli-backup.sqlite3'
        restored=self.root/'cli-restored.sqlite3'
        env={**os.environ,'PULSE_DB':str(self.source)}
        for args in [('backup',str(backup)),('restore',str(backup),str(restored))]:
            proc=subprocess.run([sys.executable,str(root/'scripts/database.py'),*args],env=env,capture_output=True,text=True)
            self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertTrue(restored.is_file())


if __name__=='__main__':unittest.main(verbosity=2)
