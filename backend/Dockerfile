FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# media/ and staticfiles/ become volumes shared with nginx; create them owned by the app user so uploads can be written.
RUN useradd --create-home app && mkdir -p media staticfiles && chown -R app:app media staticfiles
USER app

EXPOSE 8000
# Migrations, the role/permission seed and the rate-limit cache table are idempotent, so they run on every deploy.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py createcachetable && python manage.py seed_reference && python manage.py collectstatic --noinput && exec gunicorn config.wsgi --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-3} --timeout 60 --access-logfile -"]
