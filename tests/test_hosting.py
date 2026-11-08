import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path


class HostingConfiguration(unittest.TestCase):
    def run_scenario(self,trusted):
        with tempfile.TemporaryDirectory() as tmp:
            env={**os.environ,'PULSE_DB':str(Path(tmp)/'pulse.sqlite3'),'COOKIE_SECURE':'1','TRUSTED_PROXY_IPS':'127.0.0.1' if trusted else ''}
            proc=subprocess.Popen([sys.executable,str(Path(__file__).resolve().parents[1]/'server.py'),'--port','0'],env=env,stdout=subprocess.PIPE,text=True)
            base=proc.stdout.readline().strip().split(' ')[-1]
            try:
                def login(name,password,ip):
                    req=urllib.request.Request(base+'/api/login',data=json.dumps({'login':name,'password':password}).encode(),headers={'Content-Type':'application/json','X-Forwarded-For':ip})
                    try:response=urllib.request.urlopen(req)
                    except urllib.error.HTTPError as error:response=error
                    with response:
                        response.read()
                        return response.status,response.headers
                for i in range(10):
                    self.assertEqual(login('alisa','wrong','192.0.2.1')[0],401)
                status,headers=login('mark','PulseDemo2!','192.0.2.2')
                if trusted:
                    self.assertEqual(status,200)
                    self.assertIn('; Secure',headers['Set-Cookie'])
                else:
                    self.assertEqual(status,429,'Недоверенный X-Forwarded-For не должен обходить IP-ограничение')
            finally:
                proc.terminate();proc.wait(timeout=10);proc.stdout.close()

    def test_secure_cookie_and_trusted_proxy(self):self.run_scenario(True)
    def test_untrusted_forwarded_header_ignored(self):self.run_scenario(False)


if __name__=='__main__':unittest.main(verbosity=2)
