"""Logging filter that blanks credentials before a log line is written (console, gunicorn, error tracebacks)."""
import logging
import re

# key=…, token=…, password=… in URLs, query strings and form bodies; session/CSRF cookies; Authorization headers.
SECRET = re.compile(
    r'(?i)\b(key|api_key|apikey|token|password|passwd|new_password|old_password|current_password|secret|'
    r'sessionid|csrftoken|csrfmiddlewaretoken)(["\']?\s*[=:]\s*["\']?)[^\s&"\',;]+'
)
AUTH_HEADER = re.compile(r'(?i)(authorization["\']?\s*[=:]\s*["\']?)(\w+\s+)?[^\s"\',;]+')


def redact(text):
    return AUTH_HEADER.sub(r'\1\2***', SECRET.sub(r'\1\2***', text))


class RedactSecrets(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        clean = redact(message)
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        if clean != message:
            record.msg, record.args = clean, None
        return True
