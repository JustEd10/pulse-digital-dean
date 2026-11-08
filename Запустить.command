#!/bin/zsh
cd "$(dirname "$0")" || exit 1
echo 'Пульс — локальный прототип'
echo 'Откройте http://127.0.0.1:8000 после запуска сервера.'
echo 'Для остановки нажмите Ctrl+C.'
python3 server.py
