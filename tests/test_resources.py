"""Regress the exceptional path before the database context has yielded."""
import sqlite3
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server


class ResourceLifetime(unittest.TestCase):
    def test_connection_closed_if_setup_fails(self):
        class SetupFailure(sqlite3.Connection):
            def execute(self,sql,*args,**kwargs):
                if sql=='PRAGMA foreign_keys=ON':
                    raise sqlite3.OperationalError('Simulated connection setup failure')
                return super().execute(sql,*args,**kwargs)

        connection=sqlite3.connect(':memory:',factory=SetupFailure)
        try:
            with patch.object(server.sqlite3,'connect',return_value=connection):
                with self.assertRaises(sqlite3.OperationalError):
                    with server.connect():
                        self.fail('Setup should fail before yielding')
            with self.assertRaises(sqlite3.ProgrammingError):
                connection.execute('SELECT 1')
        finally:
            connection.close()


if __name__=='__main__':unittest.main(verbosity=2)
