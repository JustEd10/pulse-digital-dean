"""Пульс — локальный конкурсный прототип. Только стандартная библиотека Python."""
import argparse
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get('PULSE_DB', str(ROOT / 'data' / 'pulse.sqlite3'))).expanduser().resolve()
TRUSTED_PROXY_IPS = {v.strip() for v in os.environ.get('TRUSTED_PROXY_IPS', '').split(',') if v.strip()}
MOSCOW = timezone(timedelta(hours=3))
KINDS = {'study': 'Справка об обучении', 'scholarship': 'Справка о стипендии', 'application': 'Заявление в деканат'}
SCHEDULE_NOTICE = 'На этой неделе два семинара перенесены из аудитории 304 в 412. Изменения отмечены в расписании.'
USERS = [
    (1, 'alisa', '79cfb4a3011d12bf05cc802862a41f00', 'cfcc38b5c2959f6035f38ce72dc42b4d8fb83f3d9b5d36bf20326c0156b87f79', 'Алиса', 'Алиса Романовна Лескова', 'Институт цифровой экономики', 'Бизнес-информатика', 2, 'БИ-24-03', 'АЛ', '2024-0318'),
    (2, 'mark', '3bbd97fb0bea4cb4ccbffe578df23ee7', '8aff3c621255526dc10e2b97bb721734fed0051c7a153a69fec8074b62fb3d52', 'Марк', 'Марк Андреевич Ветров', 'Институт управления', 'Менеджмент', 3, 'МН-23-01', 'МВ', '2023-0126'),
]


@contextmanager
def connect():
    db = sqlite3.connect(str(DB_PATH), timeout=10)
    try:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        with db:
            yield db
    finally:
        db.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Do not change permissions on an existing parent such as /tmp or a mounted volume.
    try:
        fd = os.open(str(DB_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
    except FileExistsError:
        pass
    os.chmod(DB_PATH, 0o600)
    with connect() as db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, login TEXT UNIQUE, salt TEXT, password_hash TEXT,
        first_name TEXT, full_name TEXT, faculty TEXT, direction TEXT, course INTEGER, student_group TEXT, initials TEXT, record_number TEXT);
        CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), csrf TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT, purpose TEXT, copies INTEGER,
        status TEXT, created TEXT, note TEXT);
        CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT, body TEXT, category TEXT, is_read INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT, due TEXT, done INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER, reset REAL);
        ''')
        for u in USERS:
            db.execute('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', u)
            uid = u[0]
            now = datetime.now(MOSCOW)
            db.execute('INSERT OR IGNORE INTO requests VALUES (?,?,?,?,?,?,?,?)',
                       ('demo-%s' % uid, uid, 'study', 'По месту требования', 1, 'ready', (now-timedelta(days=2)).isoformat(), 'Демонстрационный документ. Можно скачать образец.'))
            for i, row in enumerate([
                ('Изменение аудитории', SCHEDULE_NOTICE, 'schedule'),
                ('Пора выбрать тему проекта', 'Согласуй тему курсового проекта с руководителем до 27 ноября. Отметь дело выполненным, когда будешь готов.', 'deadline'),
                ('Справка готова', 'Ваш демонстрационный образец справки доступен в разделе «Заявки и справки».', 'request'),
            ]):
                db.execute('INSERT OR IGNORE INTO notifications VALUES (?,?,?,?,?,?)', (uid*10+i, uid, *row, 0))
            db.execute('UPDATE notifications SET body=? WHERE id=? AND body=?',
                       (SCHEDULE_NOTICE, uid*10, 'Ближайший семинар перенесён из аудитории 304 в 412. В расписании уже всё обновлено.'))
            db.execute('UPDATE notifications SET body=? WHERE id=? AND body=?',
                       ('Согласуй тему курсового проекта с руководителем до 27 ноября. Отметь дело выполненным, когда будешь готов.',
                        uid*10+1, 'Согласуйте тему курсового проекта с руководителем до 12 ноября. Отметьте дело выполненным, когда будете готовы.'))
            for i, row in enumerate([('Выбрать тему курсовой', 'До 27 ноября'), ('Загрузить практическую работу', 'До 25 ноября')]):
                db.execute('INSERT OR IGNORE INTO tasks VALUES (?,?,?,?,?)', (uid*10+i, uid, *row, 0))
                db.execute('UPDATE tasks SET due=? WHERE id=? AND due=?',
                           (row[1], uid*10+i, ('До 12 ноября', 'До 10 ноября')[i]))
    try:
        os.chmod(DB_PATH, 0o600)
    except OSError:
        pass


def profile(row):
    return {k: row[k] for k in ['id', 'login', 'first_name', 'full_name', 'faculty', 'direction', 'course', 'student_group', 'initials', 'record_number']}


def academic(uid):
    names = ['Анализ данных', 'Проектирование информационных систем', 'Экономика предприятия', 'Английский язык', 'Высшая математика', 'Физическая культура'] if uid == 1 else ['Стратегический менеджмент', 'Маркетинговые исследования', 'Финансовый анализ', 'Деловой английский', 'Управление проектами', 'Физическая культура']
    scores = [92, 85, 78, 94, 88, 100] if uid == 1 else [81, 90, 74, 86, 96, 100]
    return [dict(name=name, score=score, grade=('Зачёт' if i in [3, 5] else '5' if score >= 85 else '4'), exam=('Зачёт' if i in [3, 5] else 'Экзамен'), exam_date=('18 декабря' if i % 2 == 0 else '22 декабря')) for i, (name, score) in enumerate(zip(names, scores))]


def timetable(uid):
    today = datetime.now(MOSCOW).date()
    monday = today - timedelta(days=today.weekday())
    subjects = academic(uid)
    teachers = ['Н. А. Миронова', 'И. В. Северин', 'О. П. Ланская', 'А. Д. Озеров']
    days = []
    for d in range(7):
        date = monday+timedelta(days=d)
        items = []
        if d != 6:
            for i, (start, end) in enumerate([('09:00', '10:30'), ('10:40', '12:10'), ('13:00', '14:30')][:2 if d == 5 else 3]):
                idx = (d+i+uid-1) % 5
                changed = i == 1 and d in (2, 4)
                items.append(dict(id='%s-%s-%s' % (uid,d,i), start=start, end=end, name=subjects[idx]['name'], type='Семинар' if i%2 else 'Лекция', room=('412' if changed else '304') if i==1 else str(301+d), building='Корпус 2', teacher=teachers[(d+i)%4], changed=changed, change='Аудитория 304 → 412' if changed else None))
        days.append(dict(date=date.isoformat(), today=date==today, items=items))
    return days


class Handler(BaseHTTPRequestHandler):
    server_version = 'Pulse'

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def client_ip(self):
        peer = self.client_address[0]
        # A single trusted reverse proxy must overwrite this header, not append to it.
        forwarded = self.headers.get('X-Forwarded-For', '').strip()
        if peer in TRUSTED_PROXY_IPS and forwarded:
            try:
                return str(ipaddress.ip_address(forwarded))
            except ValueError:
                pass
        return peer

    def log_message(self, fmt, *args):
        # Do not log query strings, passwords, cookies or request payloads.
        pass

    def send_data(self, code, data, content_type='application/json; charset=utf-8', extra=None):
        body = json.dumps(data, ensure_ascii=False).encode() if isinstance(data, (dict, list)) else data
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def session(self, db):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            token = cookie['pulse_session'].value
        except (KeyError, ValueError, CookieError):
            return None
        return db.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()

    def body(self):
        size = int(self.headers.get('Content-Length', '0'))
        if size < 1 or size > 8192:
            raise ValueError('Недопустимый размер запроса')
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise ValueError('Ожидается JSON')
        value = json.loads(self.rfile.read(size))
        if not isinstance(value, dict):
            raise ValueError('Ожидается объект')
        return value

    def do_GET(self):
        try:
            self.get()
        except ValueError:
            self.send_data(400, {'error': 'Некорректный адрес'})
        except (sqlite3.Error, OSError):
            self.send_data(500, {'error': 'Не удалось загрузить данные. Попробуйте ещё раз.'})

    def get(self):
        path = urlsplit(self.path).path
        if path == '/healthz':
            with connect() as db:
                db.execute('SELECT 1 FROM users LIMIT 1').fetchone()
            self.send_data(200, {'status': 'ok'})
            return
        if not path.startswith('/api/'):
            files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'application/javascript; charset=utf-8'), '/styles.css': ('styles.css', 'text/css; charset=utf-8'), '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
            if path not in files:
                self.send_data(404, {'error': 'Страница не найдена'})
                return
            file, mime = files[path]
            self.send_data(200, (ROOT/'public'/file).read_bytes(), mime)
            return
        with connect() as db:
            sess = self.session(db)
            if not sess:
                self.send_data(401, {'error': 'Войдите, чтобы открыть кабинет'})
                return
            uid = sess['user_id']
            if path == '/api/bootstrap':
                self.send_data(200, dict(user=profile(db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()), csrf=sess['csrf'], schedule=timetable(uid), grades=academic(uid), requests=[dict(r) for r in db.execute('SELECT * FROM requests WHERE user_id=? ORDER BY created DESC', (uid,))], notifications=[dict(r) for r in db.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY id', (uid,))], tasks=[dict(r) for r in db.execute('SELECT * FROM tasks WHERE user_id=?', (uid,))], today=datetime.now(MOSCOW).date().isoformat()))
            elif path.startswith('/api/students/'):
                if path != '/api/students/%s' % uid:
                    self.send_data(404, {'error': 'Данные не найдены'})
                else:
                    self.send_data(200, profile(db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()))
            elif path.startswith('/api/requests/'):
                parts = path.split('/')
                if len(parts) not in (4, 5) or not parts[3] or (len(parts) == 5 and parts[4] != 'download'):
                    self.send_data(404, {'error': 'Заявка не найдена'})
                    return
                rid = parts[3]
                row = db.execute('SELECT * FROM requests WHERE id=? AND user_id=?', (rid, uid)).fetchone()
                if not row:
                    self.send_data(404, {'error': 'Заявка не найдена'})
                elif path.endswith('/download'):
                    if row['status'] != 'ready':
                        self.send_data(409, {'error': 'Документ пока не готов'})
                    else:
                        name = db.execute('SELECT full_name FROM users WHERE id=?', (uid,)).fetchone()[0]
                        text = 'КОНКУРСНЫЙ КОНЦЕПТ «ПУЛЬС»\nДЕМОНСТРАЦИОННЫЙ ОБРАЗЕЦ — НЕ ОФИЦИАЛЬНЫЙ ДОКУМЕНТ\n\n%s\nСтудент: %s\nВсе данные вымышлены. Юридической силы не имеет.\n' % (KINDS[row['kind']], name)
                        self.send_data(200, text.encode('utf-8-sig'), 'text/plain; charset=utf-8', {'Content-Disposition': 'attachment; filename="pulse-demo-certificate.txt"'})
                else:
                    self.send_data(200, dict(row))
            else:
                self.send_data(404, {'error': 'Данные не найдены'})

    def do_POST(self):
        try:
            self.post()
        except (ValueError, TypeError, KeyError, OverflowError):
            self.send_data(400, {'error': 'Проверьте данные формы и попробуйте ещё раз'})
        except (sqlite3.Error, OSError):
            self.send_data(500, {'error': 'Не удалось сохранить данные. Попробуйте ещё раз.'})

    def post(self):
        origin = self.headers.get('Origin')
        host = self.headers.get('Host')
        if origin and origin not in ('http://'+str(host), 'https://'+str(host)):
            self.send_data(403, {'error': 'Источник запроса не разрешён'})
            return
        data = self.body()
        path = urlsplit(self.path).path
        with connect() as db:
            if path == '/api/login':
                login, password = data.get('login', ''), data.get('password', '')
                if not isinstance(login, str) or not isinstance(password, str) or len(login)>80 or len(password)>200:
                    raise ValueError()
                login = login.strip().lower()
                key = 'ip:'+self.client_ip()
                now = time.time()
                old = db.execute('SELECT count, reset FROM attempts WHERE key=?', (key,)).fetchone()
                if old and old['reset']>now and old['count']>=10:
                    self.send_data(429, {'error': 'Слишком много попыток. Подождите до 5 минут.'},
                                   extra={'Retry-After': str(max(1, int(old['reset']-now)+1))})
                    return
                user = db.execute('SELECT * FROM users WHERE login=?', (login,)).fetchone()
                salt = user['salt'] if user else USERS[0][2]
                check = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()
                now = time.time()
                db.execute('DELETE FROM attempts WHERE reset<?', (now,))
                if not user or not hmac.compare_digest(check, user['password_hash']):
                    db.execute('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, now+300))
                    db.commit()
                    self.send_data(401, {'error': 'Неверный логин или пароль'})
                    return
                db.execute('DELETE FROM attempts WHERE key=?', (key,))
                db.execute('DELETE FROM sessions WHERE expires<?', (now,))
                current = self.session(db)
                if current:
                    db.execute('DELETE FROM sessions WHERE token_hash=?', (current['token_hash'],))
                token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
                db.execute('INSERT INTO sessions VALUES (?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user['id'], csrf, now+43200))
                db.commit()
                secure = '; Secure' if os.environ.get('COOKIE_SECURE') == '1' else ''
                self.send_data(200, {'ok': True}, extra={'Set-Cookie': 'pulse_session=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200%s' % (token, secure)})
                return
            sess = self.session(db)
            if not sess:
                self.send_data(401, {'error': 'Сессия завершена. Войдите снова.'})
                return
            if not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), sess['csrf']):
                self.send_data(403, {'error': 'Обновите страницу и повторите действие'})
                return
            uid = sess['user_id']
            if path == '/api/logout':
                db.execute('DELETE FROM sessions WHERE token_hash=?', (sess['token_hash'],))
                db.commit()
                self.send_data(200, {'ok': True}, extra={'Set-Cookie': 'pulse_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'})
            elif path == '/api/requests':
                kind, purpose, copies = data.get('kind'), data.get('purpose', ''), data.get('copies', 1)
                if not isinstance(kind,str) or kind not in KINDS or not isinstance(purpose,str) or not 3<=len(purpose.strip())<=500 or type(copies) is not int or not 1<=copies<=3:
                    raise ValueError()
                retry_key = data.get('retry_key')
                if retry_key is not None and (not isinstance(retry_key, str) or not re.fullmatch(r'[a-f0-9]{32}', retry_key)):
                    raise ValueError()
                purpose = purpose.strip()
                rid = hashlib.sha256(f'{uid}:{retry_key}'.encode()).hexdigest()[:32] if retry_key else secrets.token_hex(8)
                created = db.execute('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
                                     (rid, uid, kind, purpose, copies, 'submitted', datetime.now(MOSCOW).isoformat(), 'Заявка сохранена. В прототипе сотрудник её не обрабатывает; статус не меняется автоматически.')).rowcount
                db.commit()
                saved = db.execute('SELECT * FROM requests WHERE id=? AND user_id=?', (rid, uid)).fetchone()
                if not saved or (saved['kind'], saved['purpose'], saved['copies']) != (kind, purpose, copies):
                    self.send_data(409, {'error': 'Эта попытка уже связана с другой заявкой.'})
                    return
                self.send_data(201 if created else 200, {'id': rid, 'request': dict(saved)})
            elif path == '/api/notifications/read':
                nid = data.get('id')
                if nid != 'all' and type(nid) is not int:
                    raise ValueError()
                if nid == 'all':
                    db.execute('UPDATE notifications SET is_read=1 WHERE user_id=?', (uid,))
                else:
                    cur = db.execute('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', (nid, uid))
                    if not cur.rowcount:
                        self.send_data(404, {'error': 'Уведомление не найдено'})
                        return
                db.commit()
                self.send_data(200, {'ok': True})
            elif path == '/api/tasks/toggle':
                if type(data.get('id')) is not int:
                    raise ValueError()
                cur = db.execute('UPDATE tasks SET done=1-done WHERE id=? AND user_id=?', (data.get('id'), uid))
                db.commit()
                self.send_data(200 if cur.rowcount else 404, {'ok': True} if cur.rowcount else {'error': 'Задача не найдена'})
            else:
                self.send_data(404, {'error': 'Действие не найдено'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default=os.environ.get('HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8000')))
    args = parser.parse_args()
    init_db()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print('Пульс: http://%s:%s' % server.server_address, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
