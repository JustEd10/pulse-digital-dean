"""Run the real test suite and reject SQLite connections left open after a test.

SQLite's context manager commits/rolls back; it does not close the connection.
Strong references and a live SQL probe make this guard useful even on Python
versions predating the SQLite ResourceWarning. Application code is not patched
outside this test process. Child server/CLI processes inherit strict warnings;
their individual connections are not instrumented by this runner.
"""
import gc
import os
import sqlite3
import sys
import unittest
import warnings
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
connections=[]
unraisable=[]
original_connect=sqlite3.connect


def tracked_connect(*args,**kwargs):
    connection=original_connect(*args,**kwargs)
    connections.append(connection)
    return connection


class ResourceResult(unittest.TextTestResult):
    def startTest(self,test):
        connections.clear()
        unraisable.clear()
        self.pending_success=False
        super().startTest(test)

    def addSuccess(self,test):
        self.pending_success=True

    def stopTest(self,test):
        gc.collect()
        leaked=[]
        for connection in connections:
            try:
                connection.execute('SELECT 1')
            except sqlite3.ProgrammingError:
                continue
            except sqlite3.Error:
                # A connection that still accepts calls but reports a DB error is open.
                pass
            leaked.append(connection)
        for connection in leaked:
            connection.close()
        if leaked or unraisable:
            try:
                raise AssertionError('Open SQLite connections: %s; unraisable ResourceWarning: %s' % (len(leaked),len(unraisable)))
            except AssertionError:
                self.addFailure(test,sys.exc_info())
        elif self.pending_success:
            super().addSuccess(test)
        connections.clear()
        super().stopTest(test)


def main():
    previous_hook=sys.unraisablehook
    previous_env=os.environ.get('PYTHONWARNINGS')
    def unraisable_hook(event):
        if isinstance(event.exc_value,ResourceWarning):
            unraisable.append(event.exc_type.__name__)
        else:
            previous_hook(event)
    try:
        sys.unraisablehook=unraisable_hook
        os.environ['PYTHONWARNINGS']='error::ResourceWarning'
        with warnings.catch_warnings(),patch.object(sqlite3,'connect',tracked_connect):
            warnings.simplefilter('error',ResourceWarning)
            suite=unittest.defaultTestLoader.discover(str(ROOT/'tests'))
            result=unittest.TextTestRunner(verbosity=2,resultclass=ResourceResult).run(suite)
        if result.wasSuccessful():
            print('SQLite lifetime guard: no open connections after tests.')
        return 0 if result.wasSuccessful() else 1
    finally:
        sys.unraisablehook=previous_hook
        if previous_env is None:os.environ.pop('PYTHONWARNINGS',None)
        else:os.environ['PYTHONWARNINGS']=previous_env


if __name__=='__main__':raise SystemExit(main())
