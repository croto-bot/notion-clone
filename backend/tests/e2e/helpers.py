"""Small helpers for e2e tests: assertions and data set-up through the real API."""

from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import psycopg

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    import httpx

    from tests.e2e.stack import Database

from tests.e2e.stack import SERVER_DB_POOL_SIZE

DEFAULT_PASSWORD = "correct-horse-battery-staple"
WS_TIMEOUT_S = 5.0
EXPIRED = "2000-01-01 00:00:00+00"
# JSON allows "\u0000" in strings; Postgres text cannot store it.
NUL = "\u0000"


@dataclass
class RegisteredUser:
    """A user created through POST /auth/register, logged in through POST /auth/login."""

    id: str
    email: str
    password: str
    display_name: str
    session_id: str
    client: httpx.Client


def unique_email(prefix: str = "user") -> str:
    """Return an email address no other test uses."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.com"


def assert_error(
    response: httpx.Response,
    status: int,
    error_code: str,
    detail: Any = None,
) -> dict[str, Any]:
    """Assert the API error contract: the status and a JSON ``{detail, error_code}``."""
    assert response.status_code == status, (
        f"expected {status}, got {response.status_code}: {response.text}"
    )
    body = response.json()
    assert set(body) == {"detail", "error_code"}, body
    assert body["error_code"] == error_code, body
    if detail is not None:
        assert body["detail"] == detail, body
    return body


def create_workspace(
    client: httpx.Client, name: str = "E2E Workspace", icon: str | None = None
) -> dict[str, Any]:
    """Create a workspace through POST /workspaces and return the body."""
    payload: dict[str, Any] = {"name": name}
    if icon is not None:
        payload["icon"] = icon
    response = client.post("/workspaces", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# Sentinel so tests can pass an explicit after_id=None (= first, SPEC §3).
UNSET: Any = object()


def create_page(
    client: httpx.Client,
    workspace_id: str,
    *,
    parent_id: str | None = None,
    title: str = "Page",
    kind: str = "page",
    after_id: Any = UNSET,
    icon: str | None = None,
    properties: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a page through POST /pages and return the response body."""
    payload: dict[str, Any] = {
        "workspace_id": workspace_id,
        "title": title,
        "kind": kind,
    }
    if parent_id is not None:
        payload["parent_id"] = parent_id
    if after_id is not UNSET:
        payload["after_id"] = after_id
    if icon is not None:
        payload["icon"] = icon
    if properties is not None:
        payload["properties"] = properties
    response = client.post("/pages", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def add_member(
    owner_client: httpx.Client,
    workspace_id: str,
    user: RegisteredUser,
    role: str = "editor",
) -> dict[str, Any]:
    """The owner adds a registered user to the workspace; returns the member."""
    response = owner_client.post(
        f"/workspaces/{workspace_id}/members",
        json={"email": user.email, "role": role},
    )
    assert response.status_code == 201, response.text
    return response.json()


def make_member(
    register_user: Callable[..., RegisteredUser],
    owner_client: httpx.Client,
    workspace_id: str,
    role: str = "editor",
) -> RegisteredUser:
    """Register a user and add them to the workspace with the given role."""
    user = register_user()
    add_member(owner_client, workspace_id, user, role=role)
    return user


def login(api: httpx.Client, email: str, password: str) -> httpx.Response:
    """Call POST /auth/login and return the raw response."""
    return api.post("/auth/login", json={"email": email, "password": password})


# --- State the public API cannot create --------------------------------------
# Email delivery is not implemented, so the database is the "inbox": tests read
# emailed tokens from it. Expiry and deactivation have no endpoint either.


def password_reset_token(db: Database, user_id: str) -> str:
    """Return the user's newest unused password reset token (the emailed one)."""
    return db.fetch_one(
        "SELECT id FROM password_reset_token WHERE user_id = %s AND used_at IS NULL "
        "ORDER BY created_at DESC LIMIT 1",
        (user_id,),
    )[0]


def email_verification_token(db: Database, user_id: str) -> str:
    """Return the user's newest unused email verification token (the emailed one)."""
    return db.fetch_one(
        "SELECT id FROM email_verification_token "
        "WHERE user_id = %s AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
        (user_id,),
    )[0]


def deactivate_user(db: Database, user_id: str) -> None:
    """Set ``is_active = false`` (an admin action the API does not offer)."""
    assert db.execute('UPDATE "user" SET is_active = false WHERE id = %s', (user_id,))


def create_passwordless_user(db: Database, email: str) -> None:
    """Insert a user without a password, as Google sign-up creates one.

    The Google token exchange needs a third party, so the row is inserted
    directly.
    """
    db.execute(
        'INSERT INTO "user" '
        "(id, email, display_name, is_active, password, created_at, updated_at) "
        "VALUES (gen_random_uuid(), %s, 'OAuth User', true, NULL, now(), now())",
        (email,),
    )


@contextmanager
def drop_server_connections(db: Database, client: httpx.Client) -> Iterator[None]:
    """Cut the live server off from Postgres (an outage) for the ``with`` block.

    Use it as ``with drop_server_connections(db, client): response = client.get(...)``.
    Every request in the block that uses the database fails, like after a
    database restart or a network cut. (The server runs with the production
    default DB_POOL_PRE_PING=false, so it does not test connections first.)
    Send one successful request before this, so the server has connections.

    Postgres refuses new connections to the database until the block ends,
    so the server cannot replace a dropped connection with a working one.
    The open connection of ``db`` stays, so ``db`` works in the block.
    When the block ends, ``client`` sends requests until the server's pool
    holds no dropped connection, so later requests and tests are not hit.
    """
    _wait_until_server_connections_are_idle(db)
    db.allow_connections(False)
    try:
        rows = db.fetch_all(
            "SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity "
            f"WHERE {_SERVER_BACKENDS}"
        )
        assert rows, "the server had no database connection to drop"
        assert all(terminated for (terminated,) in rows), rows
        yield
    finally:
        db.allow_connections(True)
        _wait_until_server_pool_recovers(client)


# The server's connections: every client backend on this database except db's.
_SERVER_BACKENDS = (
    "datname = current_database() AND pid <> pg_backend_pid() "
    "AND backend_type = 'client backend'"
)


def _wait_until_server_pool_recovers(client: httpx.Client) -> None:
    # A dropped connection stays in the pool until a request uses it and
    # fails. The pool hands out idle connections in order (FIFO), so
    # pool-size + 1 database requests in a row without a 500 prove that every
    # pooled connection works again. A login with an unknown email reads the
    # database and needs no account.
    successes = attempts = 0
    while successes <= SERVER_DB_POOL_SIZE:
        attempts += 1
        assert attempts <= 10 * SERVER_DB_POOL_SIZE, "the server did not recover"
        response = client.post(
            "/auth/login",
            json={"email": unique_email(), "password": DEFAULT_PASSWORD},
        )
        successes = successes + 1 if response.status_code != 500 else 0


def _wait_until_server_connections_are_idle(db: Database) -> None:
    # The server ends a request's transaction (COMMIT, then the connection goes
    # back to the pool) after it sent the response. A connection dropped in
    # that step is discarded, not put back in the pool. Wait for that step to
    # end, so the pool keeps the dropped connections and the next request
    # gets one of them (a failed SQL statement, not a failed connect).
    deadline = time.monotonic() + 10
    while db.fetch_all(
        f"SELECT pid FROM pg_stat_activity WHERE {_SERVER_BACKENDS} "
        "AND state IS DISTINCT FROM 'idle'"
    ):
        assert time.monotonic() < deadline, "the server's connections stay busy"
        time.sleep(0.01)


# --- Locks and latches the public API cannot create ---------------------------------
#
# Some race windows (a write that must commit while a request is mid-flight)
# need the test to hold a database lock and release it at a chosen moment.
# The locks run on their own connection in their own transaction, so they
# stay held for the whole ``with`` block and vanish on exit.


@contextmanager
def held_db_lock(
    db: Database, statement: str, params: tuple[Any, ...] = ()
) -> Iterator[psycopg.Connection]:
    """Run one locking statement and hold its transaction for the block.

    e.g. ``with held_db_lock(db, "LOCK TABLE pages IN EXCLUSIVE MODE"):``
    parks every write to ``pages`` behind the lock while reads keep going.
    Yields the connection, so the test can act inside the same transaction
    (its commit on exit is what releases the lock).
    """
    with psycopg.connect(db.url, autocommit=True) as conn:
        # Session-level, so the locking statement below cannot wait forever.
        conn.execute("SET lock_timeout = '10s'")
        conn.autocommit = False
        with conn.transaction():
            conn.execute(statement, params)
            yield conn


def _blocked_queries(db: Database) -> list[str]:
    """The last query text of every lock-blocked server backend."""
    rows = db.fetch_all(
        "SELECT query FROM pg_stat_activity "
        "WHERE datname = current_database() AND pid <> pg_backend_pid() "
        "AND backend_type = 'client backend' "
        "AND wait_event_type = 'Lock'"
    )
    return [row[0] or "" for row in rows]


def wait_until_blocked(
    db: Database, predicate: Callable[[list[str]], bool], *, timeout: float = 10.0
) -> None:
    """Wait until ``predicate`` holds on the lock-blocked server backends.

    The predicate sees each blocked backend's last query text ("INSERT INTO
    pages", "FOR UPDATE", "pg_advisory_xact_lock"), so a test can prove
    requests are parked inside a chosen window before it releases the lock.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        queries = _blocked_queries(db)
        if predicate(queries):
            return
        time.sleep(0.05)
    raise AssertionError(f"parked queries never matched: {_blocked_queries(db)!r}")


def wait_for_blocked_queries(
    db: Database, *, count: int, needle: str, timeout: float = 10.0
) -> None:
    """Wait until ``count`` blocked backends are lock-blocked on ``needle``.

    ``needle`` is matched inside the query text the blocked backend last ran
    ("INSERT INTO pages", "FOR UPDATE", "UPDATE pages"), so a test can prove
    a request is parked inside a chosen window before it releases the lock.
    """
    wait_until_blocked(
        db,
        lambda queries: sum(needle in query for query in queries) >= count,
        timeout=timeout,
    )


# --- WebSocket helpers (the collab and events sockets) ------------------------


def ws_connect(server: Any, path: str, token: str | None = None) -> Any:
    """Open a sync WebSocket to the live server; returns the connection.

    ``server`` is the ``server`` fixture (``.base_url``).
    """
    from websockets.sync.client import connect

    url = server.base_url.replace("http://", "ws://") + path
    if token is not None:
        url += f"?token={token}"
    return connect(url, open_timeout=WS_TIMEOUT_S)


def ws_close_code(exc: Any) -> int:
    """The close code of a websockets ConnectionClosed error."""
    assert exc.rcvd is not None, exc
    return int(exc.rcvd.code)


# --- y-websocket client protocol (built with pycrdt, like the server) ---------


def yjs_sync(connection: Any, doc: Any, *, first: bytes | None = None) -> None:
    """Run the y-websocket initial sync against the room.

    Answers the server's sync step 1 with this doc's state, then asks for the
    server's state (step 1 from us) and applies its step 2 reply. ``first`` is
    a step 1 already received, so a test can time that reply on its own.
    """
    from pycrdt import create_sync_message, handle_sync_message

    step1 = first if first is not None else connection.recv(timeout=WS_TIMEOUT_S)
    assert isinstance(step1, bytes) and step1[0] == 0, step1  # SYNC
    reply = handle_sync_message(step1[1:], doc)
    if reply is not None:
        connection.send(reply)
    connection.send(create_sync_message(doc))
    deadline = time.monotonic() + WS_TIMEOUT_S
    while time.monotonic() < deadline:
        message = connection.recv(timeout=WS_TIMEOUT_S)
        assert isinstance(message, bytes) and message[0] == 0, message
        reply = handle_sync_message(message[1:], doc)
        if reply is not None:
            connection.send(reply)
        if reply is None:
            return  # step 2 applied: the doc now holds the room's state
    raise AssertionError("the server never sent its document state")


def yjs_send_update(connection: Any, doc: Any) -> None:
    """Send this doc's current state as a y-websocket update message."""
    from pycrdt import create_update_message

    connection.send(create_update_message(doc.get_update()))


def yjs_recv_update(
    connection: Any, doc: Any, *, timeout: float = WS_TIMEOUT_S
) -> bytes:
    """Receive and apply the next document message (skips awareness)."""
    from pycrdt import handle_sync_message

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        message = connection.recv(timeout=WS_TIMEOUT_S)
        if not (isinstance(message, bytes) and message[0] == 0):
            continue  # awareness or a ping: not a document message
        reply = handle_sync_message(message[1:], doc)
        if reply is not None:
            connection.send(reply)
        return message
    raise TimeoutError("no document message arrived")


def yjs_wait_for(
    connection: Any, doc: Any, needle: str, *, timeout: float = 5.0
) -> None:
    """Apply document messages until ``needle`` appears in the doc's text.

    A sync round delivers several messages (step 2 replies, updates); waiting
    for the content avoids depending on how the server splits them.
    """
    from pycrdt import XmlFragment, handle_sync_message

    fragment = doc.get("document-store", type=XmlFragment)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if needle in str(fragment):
            return
        message = connection.recv(timeout=WS_TIMEOUT_S)
        if not (isinstance(message, bytes) and message[0] == 0):
            continue  # awareness or a ping
        reply = handle_sync_message(message[1:], doc)
        if reply is not None:
            connection.send(reply)
    raise TimeoutError(f"{needle!r} never arrived in the document")


def yjs_send_awareness(connection: Any, doc: Any, name: str, **fields: Any) -> None:
    """Send an awareness update (cursor/name), like a real editor client."""
    from pycrdt import Awareness, create_awareness_message

    awareness = Awareness(doc)
    awareness.set_local_state({"user": {"name": name, **fields}})
    connection.send(
        create_awareness_message(
            awareness.encode_awareness_update([awareness.client_id])
        )
    )


def doc_with_text(*paragraph_texts: str) -> tuple[Any, bytes]:
    """Return (doc, update bytes) with the paragraphs in document-store."""
    from pycrdt import Doc, XmlElement, XmlFragment, XmlText

    doc = Doc()
    fragment = doc.get("document-store", type=XmlFragment)
    with doc.transaction():
        for text in paragraph_texts:
            fragment.children.append(XmlElement("p", contents=[XmlText(text)]))
    return doc, doc.get_update()
