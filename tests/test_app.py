"""Integration checks over real HTTP and a temporary SQLite database."""
import hashlib
import http.cookiejar
import json
import os
import subprocess
import sys
import tempfile
from contextlib import closing
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Integration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.temp.name)/'test.sqlite3'
        cls.env = {**os.environ, 'PULSE_DB': str(cls.db), 'COOKIE_SECURE': '0', 'TRUSTED_PROXY_IPS': ''}
        cls.proc = subprocess.Popen([sys.executable, str(ROOT/'server.py'), '--port', '0'], env=cls.env, stdout=subprocess.PIPE, text=True)
        cls.base = cls.proc.stdout.readline().strip().split(' ')[-1]
        if not cls.base.startswith('http://'):
            raise RuntimeError('Server did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc.stdout.close()
        cls.temp.cleanup()

    def client(self):
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, client, path, data=None, csrf=None, origin=None):
        headers = {'Content-Type': 'application/json'}
        if csrf: headers['X-CSRF-Token'] = csrf
        if origin: headers['Origin'] = origin
        req = urllib.request.Request(self.base+path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            response = client.open(req)
        except urllib.error.HTTPError as e:
            response = e
        with response:
            raw = response.read()
            body = json.loads(raw) if 'application/json' in response.headers.get('Content-Type', '') else raw
            return response.status, body, response.headers

    def login(self, name):
        client = self.client()
        status, _, headers = self.call(client, '/api/login', {'login': name, 'password': 'PulseDemo1!' if name == 'alisa' else 'PulseDemo2!'})
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Strict', headers['Set-Cookie'])
        status, state, _ = self.call(client, '/api/bootstrap')
        self.assertEqual(status, 200)
        return client, state

    def test_01_static_and_anonymous(self):
        c = self.client()
        self.assertEqual(self.call(c,'/')[0], 200)
        self.assertEqual(self.call(c,'/healthz')[1], {'status':'ok'})
        for path in ['/app.js','/styles.css','/favicon.svg']:
            self.assertEqual(self.call(c,path)[0], 200)
        for path in ['/api/bootstrap','/api/students/1','/api/requests/demo-1','/api/requests/demo-1/download']:
            self.assertEqual(self.call(c,path)[0], 401)
        for path in ['/server.py','/.env','/data/pulse.sqlite3','/data/pulse.sqlite3-wal','/../server.py','/scripts/database.py','/docs/ai-process.md','/.git/config','/%2e%2e/server.py']:
            self.assertEqual(self.call(c,path)[0], 404)

    def test_02_accounts_and_isolation(self):
        a, sa = self.login('alisa')
        b, sb = self.login('mark')
        self.assertNotEqual(sa['user']['full_name'], sb['user']['full_name'])
        self.assertNotEqual(sa['grades'], sb['grades'])
        self.assertNotEqual(sa['schedule'], sb['schedule'])
        self.assertEqual(len(sa['schedule']), 7)
        self.assertEqual(sum(d['today'] for d in sa['schedule']), 1)
        for c, state, other in [(a,sa,2),(b,sb,1)]:
            own = state['user']['id']
            self.assertTrue(all(r['user_id']==own for r in state['requests']))
            self.assertTrue(all(n['user_id']==own for n in state['notifications']))
            self.assertTrue(all(t['user_id']==own for t in state['tasks']))
            self.assertNotIn('password_hash', state['user'])
            _,tampered,_=self.call(c,'/api/bootstrap?user_id=%s&student_id=%s' % (other,other))
            self.assertEqual(tampered['user']['id'],own)
            for key in ['requests','notifications','tasks']:
                self.assertTrue(all(row['user_id']==own for row in tampered[key]))
            for path in ['/api/students/%s'%other,'/api/students/%s/grades'%other,'/api/requests/demo-%s'%other,'/api/requests/demo-%s/download'%other,'/api/notifications/%s'%other]:
                self.assertEqual(self.call(c,path)[0],404)
            self.assertEqual(self.call(c,'/api/notifications/read',{'id':other*10},state['csrf'])[0],404)
            self.assertEqual(self.call(c,'/api/tasks/toggle',{'id':other*10},state['csrf'])[0],404)
            self.assertEqual(self.call(c,'/api/requests/demo-%s/download'%own)[0],200)
            self.assertEqual(self.call(c,'/api/logout',{},state['csrf'])[0],200)
            self.assertEqual(self.call(c,'/api/bootstrap')[0],401)

    def test_03_create_persist_validate(self):
        a, sa = self.login('alisa')
        b, sb = self.login('mark')
        payload={'kind':'study','purpose':'Для теста сохранения','copies':2,'user_id':2}
        self.assertEqual(self.call(a,'/api/requests',payload)[0],403)
        self.assertEqual(self.call(a,'/api/requests',payload,sa['csrf'], 'https://evil.example')[0],403)
        for bad in [{**payload,'kind':'invalid'},{**payload,'copies':0},{**payload,'copies':True},{**payload,'purpose':'x'},{**payload,'purpose':'x'*501},{**payload,'purpose':None},{**payload,'kind':[]}]:
            self.assertEqual(self.call(a,'/api/requests',bad,sa['csrf'])[0],400)
        status, result, _=self.call(a,'/api/requests',payload,sa['csrf'])
        self.assertEqual(status,201)
        self.assertEqual(result['request']['id'], result['id'])
        self.assertEqual(result['request']['purpose'], payload['purpose'])
        path='/api/requests/'+result['id']
        status, saved, _=self.call(a,path)
        self.assertEqual(status,200)
        self.assertEqual(saved['user_id'],1)
        self.assertEqual(saved['copies'],2)
        self.assertEqual(saved['status'],'submitted')
        self.assertEqual(self.call(b,path)[0],404)
        self.assertEqual(self.call(b,path+'/download')[0],404)
        self.assertEqual(self.call(a,path+'/download')[0],409)
        self.assertEqual(self.call(a,path+'/unexpected')[0],404)
        self.call(a,'/api/logout',{},sa['csrf'])
        a,sa=self.login('alisa')
        self.assertIn(result['id'],[r['id'] for r in sa['requests']])
        # Open a fresh SQLite connection, proving this is durable server data.
        import sqlite3
        with closing(sqlite3.connect(str(self.db))) as db, db:
            self.assertEqual(db.execute('SELECT purpose FROM requests WHERE id=?',(result['id'],)).fetchone()[0],payload['purpose'])

    def test_04_notifications_tasks_and_auth(self):
        a,sa=self.login('alisa')
        self.assertEqual(self.call(a,'/api/notifications/read',{'id':'all'},sa['csrf'])[0],200)
        self.assertEqual(self.call(a,'/api/tasks/toggle',{'id':10},sa['csrf'])[0],200)
        _,updated,_=self.call(a,'/api/bootstrap')
        self.assertTrue(all(n['is_read'] for n in updated['notifications']))
        self.assertNotEqual(sa['tasks'][0]['done'],updated['tasks'][0]['done'])
        self.assertEqual(self.call(self.client(),'/api/login',{'login':'alisa','password':'wrong'})[0],401)
        self.assertEqual(self.call(self.client(),'/api/login',{'login':'alisa','password':'PulseDemo1!'},origin='https://evil.example')[0],403)

    def test_05_database_contains_only_hashes(self):
        import sqlite3
        with closing(sqlite3.connect(str(self.db))) as db, db:
            for login,salt,encoded in db.execute('SELECT login,salt,password_hash FROM users'):
                password='PulseDemo1!' if login=='alisa' else 'PulseDemo2!'
                self.assertEqual(encoded,hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex())
                self.assertNotEqual(encoded,password)
        self.assertNotIn(b'PulseDemo1!',self.db.read_bytes())

    def test_06_session_expiry_and_throttling(self):
        a,sa=self.login('alisa')
        import sqlite3
        with closing(sqlite3.connect(str(self.db))) as db, db:
            db.execute('UPDATE sessions SET expires=0 WHERE csrf=?',(sa['csrf'],))
        self.assertEqual(self.call(a,'/api/bootstrap')[0],401)
        self.assertEqual(self.call(a,'/api/requests',{'kind':'study','purpose':'Test','copies':1},sa['csrf'])[0],401)
        c=self.client()
        for i in range(10):
            status,_,_=self.call(c,'/api/login',{'login':'nobody','password':'bad'})
            self.assertEqual(status,401)
        self.assertEqual(self.call(c,'/api/login',{'login':'nobody','password':'bad'})[0],429)

    def test_07_persistence_after_server_restart(self):
        import sqlite3
        with closing(sqlite3.connect(str(self.db))) as db, db:
            db.execute('DELETE FROM attempts')
        a,state=self.login('alisa')
        _,saved,_=self.call(a,'/api/requests',{'kind':'application','purpose':'Проверка перезапуска','copies':1},state['csrf'])
        self.proc.terminate()
        self.proc.wait(timeout=10)
        self.proc.stdout.close()
        proc=subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--port','0'],env=self.env,stdout=subprocess.PIPE,text=True)
        type(self).proc=proc
        type(self).base=proc.stdout.readline().strip().split(' ')[-1]
        _,state=self.login('alisa')
        self.assertIn(saved['id'],[r['id'] for r in state['requests']])

    def test_08_bad_payloads_and_cookie_policy(self):
        a,state=self.login('alisa')
        for path in ['/api/tasks/toggle','/api/notifications/read']:
            for value in [None,[],{},True,'10']:
                self.assertEqual(self.call(a,path,{'id':value},state['csrf'])[0],400)
        for raw in [b'null',b'[]',b'{bad',b'x'*8193]:
            request=urllib.request.Request(self.base+'/api/requests',data=raw,headers={'Content-Type':'application/json','X-CSRF-Token':state['csrf']})
            with self.assertRaises(urllib.error.HTTPError) as error:
                a.open(request)
            self.assertEqual(error.exception.code,400)
            error.exception.close()
        _,_,headers=self.call(a,'/')
        self.assertEqual(headers['X-Content-Type-Options'],'nosniff')
        self.assertIn("frame-ancestors 'none'",headers['Content-Security-Policy'])


if __name__=='__main__':
    unittest.main(verbosity=2)
