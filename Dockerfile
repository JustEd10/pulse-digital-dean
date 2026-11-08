FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=8000 PULSE_DB=/data/pulse.sqlite3 COOKIE_SECURE=1
EXPOSE 8000
CMD ["python", "server.py"]
