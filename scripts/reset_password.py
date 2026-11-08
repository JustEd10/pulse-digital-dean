"""Interactive reset without putting the new password in process arguments."""
import getpass
import hashlib
import secrets
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import connect, init_db

init_db()
login = input('Логин вымышленного студента: ').strip()
password = getpass.getpass('Новый демонстрационный пароль (от 10 символов): ')
if len(password)<10:
    raise SystemExit('Нужно не меньше 10 символов')
salt=secrets.token_hex(16)
encoded=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex()
with connect() as db:
    user=db.execute('SELECT id FROM users WHERE login=?',(login,)).fetchone()
    if not user: raise SystemExit('Такого аккаунта нет')
    db.execute('UPDATE users SET salt=?,password_hash=? WHERE id=?',(salt,encoded,user['id']))
    db.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
print('Пароль изменён. Старые сессии завершены. Обновите демодоступ в интерфейсе и документации.')
