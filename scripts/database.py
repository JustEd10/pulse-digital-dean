"""Consistent SQLite snapshots, including WAL. Restores always use a new file."""
import argparse
import os
import secrets
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import DB_PATH

TABLES = {'users', 'sessions', 'requests', 'notifications', 'tasks', 'attempts'}


def snapshot(source, destination, restore=False):
    source, destination = Path(source).expanduser().resolve(), Path(destination).expanduser().resolve()
    if not source.is_file():
        raise ValueError('Исходная база не найдена: %s' % source)
    if destination.exists() or source == destination:
        raise ValueError('Путь назначения уже существует. Укажите новый файл; существующие данные не перезаписываются.')
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging = destination.with_name('.'+destination.name+'.'+secrets.token_hex(6)+'.tmp')
    try:
        fd = os.open(str(staging), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True, timeout=15)) as src:
            if src.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Проверка целостности исходной базы не пройдена')
            tables = {row[0] for row in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not TABLES.issubset(tables):
                raise ValueError('Это не база прототипа Пульс')
            dst = sqlite3.connect(str(staging))
            try:
                src.backup(dst)
                if restore:
                    dst.execute('DELETE FROM sessions')
                    dst.execute('DELETE FROM attempts')
                    dst.commit()
                # Produce a self-contained snapshot; never copy WAL files by hand.
                dst.execute('PRAGMA journal_mode=DELETE')
                if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Проверка копии не пройдена')
            finally:
                dst.close()
        # An exclusive hard link atomically installs the completed file without overwriting.
        os.link(str(staging), str(destination))
        os.chmod(destination, 0o600)
    finally:
        staging.unlink(missing_ok=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description='Резервное копирование и восстановление Пульса без перезаписи файлов')
    sub = parser.add_subparsers(dest='command', required=True)
    backup = sub.add_parser('backup')
    backup.add_argument('destination', help='Новый файл резервной копии')
    backup.add_argument('--source', default=str(DB_PATH), help='Текущая база, по умолчанию PULSE_DB')
    restore = sub.add_parser('restore')
    restore.add_argument('source', help='Файл резервной копии')
    restore.add_argument('destination', help='Новый файл восстановленной базы')
    args = parser.parse_args()
    try:
        result = snapshot(args.source, args.destination, restore=args.command=='restore')
    except (ValueError, sqlite3.Error, OSError) as error:
        parser.exit(1, 'Ошибка: %s\n' % error)
    print('Готово: %s' % result)
    if args.command=='restore':
        print('Сессии сброшены. После остановки сервера задайте PULSE_DB этим файлом и запустите сервер снова.')


if __name__ == '__main__':
    main()
