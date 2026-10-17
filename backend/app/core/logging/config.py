"""Logging configuration using loguru."""

import logging
import sys

from loguru import logger

from app.core.config import settings
from app.core.logging.sanitizer import sanitize_query_string


class InterceptHandler(logging.Handler):
    """Intercept stdlib logging and route to loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        # Get corresponding loguru level if it exists
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


class RedactAccessLogQuery(logging.Filter):
    """Redact sensitive query params in uvicorn's request and socket lines.

    uvicorn's access logger emits ``'%s - "%s %s HTTP/%s" %d'`` with the
    path and query string as an argument, and its WebSocket accept line (on
    ``uvicorn.error``) emits ``'%s - "WebSocket %s" [accepted]'`` the same
    way. Without this filter a session token passed in a query string (the
    collab socket's ``?token=``) would reach the logs in plain text. Any
    string argument that carries a query string is sanitized, whatever
    position it sits in.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple):
            record.args = tuple(
                _redact_query(arg) if isinstance(arg, str) else arg for arg in args
            )
        return True


def _redact_query(value: str) -> str:
    path, separator, query = value.partition("?")
    return f"{path}?{sanitize_query_string(query)}" if separator else value


def _get_log_level() -> str:
    """Get log level from settings, defaulting to INFO."""
    level = settings.LOG_LEVEL.upper()
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    return level if level in valid_levels else "INFO"


def _get_log_format() -> str:
    """Get log format from settings."""
    return settings.LOG_FORMAT


def configure_logging() -> None:
    """Configure loguru for the application.

    - JSON output for production (ENVIRONMENT != local)
    - Pretty console output for local development
    - Intercepts stdlib logging (SQLAlchemy, httpx, uvicorn, etc.)
    """
    # Remove default handler
    logger.remove()

    log_level = _get_log_level()
    log_format = _get_log_format()

    # Determine if we should use JSON based on environment or explicit format
    use_json = log_format == "json" or (
        log_format != "console" and settings.ENVIRONMENT != "local"
    )

    # Tracebacks never show variable values (diagnose) or frames outside the
    # catch point (backtrace): local variables hold passwords, password hashes
    # and tokens, and a traceback must not print them.
    if use_json:
        # JSON output for production
        logger.add(
            sys.stdout,
            format="{message}",
            serialize=True,
            level=log_level,
            backtrace=False,
            diagnose=False,
        )
    else:
        # Pretty console output for local development
        logger.add(
            sys.stderr,
            format=(
                "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
                "<level>{message}</level>"
            ),
            colorize=True,
            level=log_level,
            backtrace=False,
            diagnose=False,
        )

    # Bind environment context that will be included in all logs
    env_context = {
        "service": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
    }

    # Add optional deployment context
    if settings.VERSION:
        env_context["version"] = settings.VERSION
    if settings.COMMIT_HASH:
        env_context["commit_hash"] = settings.COMMIT_HASH
    if settings.INSTANCE_ID:
        env_context["instance_id"] = settings.INSTANCE_ID

    logger.configure(extra=env_context)

    # Intercept stdlib logging
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

    def _configure_uvicorn_logger(name: str, level: str) -> logging.Logger:
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = [InterceptHandler()]
        uvicorn_logger.setLevel(level)
        if not any(isinstance(f, RedactAccessLogQuery) for f in uvicorn_logger.filters):
            uvicorn_logger.addFilter(RedactAccessLogQuery())
        return uvicorn_logger

    # Set specific library log levels to reduce noise. uvicorn.access stays at
    # INFO for request lines, and both uvicorn loggers get the query-redaction
    # filter: the access lines and the WebSocket accept line both carry the
    # request's query string.
    _configure_uvicorn_logger("uvicorn.access", "INFO")
    _configure_uvicorn_logger("uvicorn.error", settings.LOG_UVICORN_ERROR_LEVEL)
    for logger_name in [
        "uvicorn",
        "sqlalchemy.engine",
        "sqlalchemy.pool",
        "httpx",
        "httpcore",
    ]:
        logging.getLogger(logger_name).handlers = [InterceptHandler()]
        logging.getLogger(logger_name).setLevel(logging.WARNING)
