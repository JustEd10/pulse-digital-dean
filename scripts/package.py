"""Create a handoff archive from an explicit allowlist, never from the live database."""
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
ROOT_FILES=['server.py','README.md','Dockerfile','.dockerignore','.gitignore','.env.example','Запустить.command']
EXTENSIONS={'.py','.md','.js','.css','.html','.svg','.jpg','.png','.json'}


def package(destination):
    destination=Path(destination).expanduser().resolve()
    files=[ROOT/name for name in ROOT_FILES]
    for folder in ['public','scripts','tests','docs']:
        files.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix.lower() in EXTENSIONS and not any(part.startswith('.') or part=='__pycache__' for part in p.relative_to(ROOT).parts))
    if any(p.is_symlink() for p in files):
        raise ValueError('Символические ссылки в исходном наборе не допускаются')
    destination.parent.mkdir(parents=True,exist_ok=True)
    # Exclusive creation: earlier deliveries remain available.
    with ZipFile(destination,'x',ZIP_DEFLATED) as archive:
        for p in sorted(files):archive.write(p,'pulse/'+str(p.relative_to(ROOT)))
    with ZipFile(destination) as archive:
        if archive.testzip() is not None:raise ValueError('Повреждён архив')
        count=len(archive.namelist())
    digest=hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix('.zip.sha256').write_text(digest+'  '+destination.name+'\n')
    return count,digest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Архив исходников Пульса без БД, окружения и служебного мусора')
    parser.add_argument('destination',help='Путь нового ZIP-архива')
    args=parser.parse_args()
    try:
        count,digest=package(args.destination)
    except (OSError,ValueError) as error:parser.exit(1,str(error)+'\n')
    print('Архив: %s\nФайлов: %s\nSHA-256: %s' % (Path(args.destination).resolve(),count,digest))
