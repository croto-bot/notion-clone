"""The collab WebSocket: y-websocket sync, persistence, read-only clients."""

from __future__ import annotations

import base64
import threading
import time
from typing import TYPE_CHECKING, Any

from pycrdt import Doc, XmlElement, XmlFragment, XmlText
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from tests.e2e.helpers import (
    create_page,
    create_workspace,
    doc_with_text,
    drop_server_connections,
    held_db_lock,
    make_member,
    wait_for_blocked_queries,
    ws_close_code,
    yjs_send_awareness,
    yjs_send_update,
    yjs_sync,
    yjs_wait_for,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import Database, LiveServer

# Longer than the collab server's 1 s debounce, so a flushed state is certain.
FLUSH_WAIT_S = 2.0


def _collab_url(server: LiveServer, page_id: str, token: str) -> str:
    return (
        f"{server.base_url.replace('http://', 'ws://')}"
        f"/pages/{page_id}/collab?token={token}"
    )


def _edit(doc: Doc, text: str) -> None:
    fragment = doc.get("document-store", type=XmlFragment)
    with doc.transaction():
        fragment.children.append(XmlElement("p", contents=[XmlText(text)]))


def _doc_text(doc: Doc) -> str:
    return str(doc.get("document-store", type=XmlFragment))


def test_client_a_edits_and_client_b_receives(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as conn_a:
        doc_a, _ = doc_with_text()
        yjs_sync(conn_a, doc_a)
        _edit(doc_a, "Typed by client A")
        yjs_send_update(conn_a, doc_a)

        with connect(url, open_timeout=5) as conn_b:
            doc_b, _ = doc_with_text()
            yjs_sync(conn_b, doc_b)
            # The server applies A's push asynchronously (write guard): wait
            # for the broadcast instead of asserting on the sync reply.
            yjs_wait_for(conn_b, doc_b, "Typed by client A")

            _edit(doc_b, "Typed by client B")
            yjs_send_update(conn_b, doc_b)
            yjs_wait_for(conn_a, doc_a, "Typed by client B")

            assert _doc_text(doc_a).count("<p>") == 2


def test_late_client_receives_current_presence(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    """A client that connects later sees who is already on the page (F6)."""
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as conn_a:
        doc_a, _ = doc_with_text()
        yjs_sync(conn_a, doc_a)
        yjs_send_awareness(conn_a, doc_a, name="Early Bird")

        with connect(url, open_timeout=5) as conn_b:
            doc_b, _ = doc_with_text()
            saw_presence = False
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not saw_presence:
                message = conn_b.recv(timeout=5)
                saw_presence = message[0] == 1 and b"Early Bird" in message
            assert saw_presence, (
                "the late client never learned the presence of the first"
            )


def test_reconnect_gets_the_persisted_state(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as conn_a:
        doc_a, _ = doc_with_text()
        yjs_sync(conn_a, doc_a)
        _edit(doc_a, "Persisted across reconnects")
        yjs_send_update(conn_a, doc_a)
        yjs_wait_for(conn_a, doc_a, "Persisted across reconnects")
    # The last disconnect persists right away; give the debounced flush a beat.
    time.sleep(FLUSH_WAIT_S)

    with connect(url, open_timeout=5) as conn_b:
        doc_b, _ = doc_with_text()
        yjs_sync(conn_b, doc_b)
        assert "Persisted across reconnects" in _doc_text(doc_b)

    stored = auth_client.get(f"/pages/{page['id']}/document").json()
    assert stored["state"]
    stored_doc = Doc()
    stored_doc.apply_update(base64.b64decode(stored["state"]))
    assert "Persisted across reconnects" in _doc_text(stored_doc)


def test_collab_text_is_extracted_and_searchable(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Collab page")
    url = _collab_url(server, page["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as conn:
        doc, _ = doc_with_text()
        yjs_sync(conn, doc)
        _edit(doc, "needle-from-collab-socket")
        yjs_send_update(conn, doc)
        yjs_wait_for(conn, doc, "needle-from-collab-socket")
    time.sleep(FLUSH_WAIT_S)

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "needle-from-collab"}
    ).json()
    assert [result["id"] for result in results] == [page["id"]]
    detail = auth_client.get(f"/pages/{page['id']}").json()
    assert detail["last_edited_by"]["id"] == auth_client.get("/users/me").json()["id"]


def test_viewer_edits_are_dropped_but_awareness_flows(
    server: LiveServer,
    auth_client: httpx.Client,
    register_user: Callable[..., RegisteredUser],
) -> None:
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")
    page = create_page(auth_client, workspace["id"])
    owner_url = _collab_url(server, page["id"], _token_of(auth_client))
    viewer_url = _collab_url(server, page["id"], viewer.session_id)

    with (
        connect(owner_url, open_timeout=5) as owner_conn,
        connect(viewer_url, open_timeout=5) as viewer_conn,
    ):
        owner_doc, _ = doc_with_text()
        yjs_sync(owner_conn, owner_doc)
        _edit(owner_doc, "Owner text")
        yjs_send_update(owner_conn, owner_doc)
        yjs_wait_for(owner_conn, owner_doc, "Owner text")

        viewer_doc, _ = doc_with_text()
        yjs_sync(viewer_conn, viewer_doc)
        # The server applies the owner's push asynchronously (write guard), so
        # wait for the broadcast instead of asserting on the sync reply.
        yjs_wait_for(viewer_conn, viewer_doc, "Owner text")

        # The viewer's document updates are dropped...
        _edit(viewer_doc, "Viewer sabotage")
        yjs_send_update(viewer_conn, viewer_doc)
        # ...while awareness still works.
        yjs_send_awareness(viewer_conn, viewer_doc, name="Viewer")
        deadline = time.monotonic() + 5
        saw_awareness = False
        while time.monotonic() < deadline and not saw_awareness:
            message = owner_conn.recv(timeout=5)
            saw_awareness = message[0] == 1  # YMessageType.AWARENESS
        assert saw_awareness

        # An editor's next broadcast proves the viewer's text never landed.
        _edit(owner_doc, "Editor follow-up")
        yjs_send_update(owner_conn, owner_doc)
        yjs_wait_for(owner_conn, owner_doc, "Editor follow-up")
        assert "Viewer sabotage" not in _doc_text(owner_doc)

    time.sleep(FLUSH_WAIT_S)
    stored = auth_client.get(f"/pages/{page['id']}/document").json()
    stored_doc = Doc()
    stored_doc.apply_update(base64.b64decode(stored["state"]))
    assert "Viewer sabotage" not in _doc_text(stored_doc)


def test_trashed_page_updates_are_dropped(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    auth_client.delete(f"/pages/{page['id']}")
    url = _collab_url(server, page["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as conn:
        doc, _ = doc_with_text()
        yjs_sync(conn, doc)
        _edit(doc, "Edit on a trashed page")
        yjs_send_update(conn, doc)
    time.sleep(FLUSH_WAIT_S)

    stored = auth_client.get(f"/pages/{page['id']}/document").json()
    stored_doc = Doc()
    stored_doc.apply_update(base64.b64decode(stored["state"]))
    assert "Edit on a trashed page" not in _doc_text(stored_doc)


def test_bad_token_closes_4401(server: LiveServer, auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], "s_not-a-real-token")

    with connect(url, open_timeout=5) as conn:
        try:
            conn.recv(timeout=5)
            raise AssertionError("the socket was not closed")
        except ConnectionClosed as exc:
            assert ws_close_code(exc) == 4401


def test_non_member_closes_4404(
    server: LiveServer,
    auth_client: httpx.Client,
    register_user: Callable[..., RegisteredUser],
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    stranger = register_user()
    url = _collab_url(server, page["id"], stranger.session_id)

    with connect(url, open_timeout=5) as conn:
        try:
            conn.recv(timeout=5)
            raise AssertionError("the socket was not closed")
        except ConnectionClosed as exc:
            assert ws_close_code(exc) == 4404


def _token_of(client: httpx.Client) -> str:
    return client.headers["Authorization"].removeprefix("Bearer ")


# --- concurrent document writes (review finding 1) ------------------------------


def test_put_document_during_socket_connect_is_not_lost(
    server: LiveServer, auth_client: httpx.Client, db: Database
) -> None:
    """A PUT that commits exactly while a socket connects must win.

    The interleaving is forced, not hoped for: a held row lock parks the
    PUT's database write mid-request, inside the per-page lock it shares
    with the room. The socket completes its handshake while the PUT is
    still in flight. pg_stat_activity proves the write is parked, and no
    sync reply may arrive in that window: a room that does not wait on
    the page lock would answer the sync while the PUT is still parked.
    The room is then built from the committed import, so the disconnect
    flush keeps both the import and the socket's own edit.
    """
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], _token_of(auth_client))
    _doc, update = doc_with_text("imported-via-put")
    state = base64.b64encode(update).decode()
    box: dict[str, Any] = {}
    connected = threading.Event()

    def _put() -> None:
        box["response"] = auth_client.put(
            f"/pages/{page['id']}/document", json={"state": state}
        )

    def _await_sync() -> None:
        with connect(url, open_timeout=5) as conn:
            connected.set()
            first = conn.recv(timeout=8)
            box["sync_at"] = time.monotonic()
            doc, _ = doc_with_text()
            yjs_sync(conn, doc, first=first)
            box["imported"] = "imported-via-put" in _doc_text(doc)
            _edit(doc, "typed-in-the-socket")
            yjs_send_update(conn, doc)
            yjs_wait_for(conn, doc, "typed-in-the-socket")

    with held_db_lock(
        db, "SELECT id FROM pages WHERE id = %s FOR UPDATE", (page["id"],)
    ):
        put_thread = threading.Thread(target=_put)
        put_thread.start()
        wait_for_blocked_queries(db, count=1, needle="UPDATE pages")
        sync_thread = threading.Thread(target=_await_sync)
        sync_thread.start()
        assert connected.wait(timeout=5), "the socket handshake did not finish"
        # A room that does not wait on the page lock answers sync here.
        time.sleep(0.5)
        assert "sync_at" not in box, "sync reply arrived while the PUT was parked"
    put_thread.join(timeout=10)
    sync_thread.join(timeout=10)
    assert box["response"].status_code == 200, box["response"].text
    assert "sync_at" in box, "the socket never received a sync reply"
    assert box["imported"] is True
    time.sleep(FLUSH_WAIT_S)  # the disconnect flush (and the debounce) run

    stored = auth_client.get(f"/pages/{page['id']}/document").json()
    stored_doc = Doc()
    stored_doc.apply_update(base64.b64decode(stored["state"]))
    text = _doc_text(stored_doc)
    assert "imported-via-put" in text
    assert "typed-in-the-socket" in text


def test_failed_flush_keeps_the_edit_dirty_and_retries(
    server: LiveServer, auth_client: httpx.Client, db: Database
) -> None:
    """A flush whose database write fails must be retried, not dropped.

    The dirty flag may only be cleared after a successful write: an outage
    during the debounce tick must not lose the edit forever. The tick phase is
    pinned first (a warm-up edit provably flushed), so the next tick is ~1 s
    away and fires inside the outage, not before it.
    """
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as conn:
        doc, _ = doc_with_text()
        yjs_sync(conn, doc)
        _edit(doc, "warm-up")
        yjs_send_update(conn, doc)
        yjs_wait_for(conn, doc, "warm-up")
        _await_flushed(db, page["id"], "warm-up")  # a debounce tick just ran

        _edit(doc, "edit-during-outage")
        yjs_send_update(conn, doc)
        yjs_wait_for(conn, doc, "edit-during-outage")
        with drop_server_connections(db, auth_client):
            time.sleep(FLUSH_WAIT_S + 0.5)  # the next tick fails here
    time.sleep(FLUSH_WAIT_S)  # the retry (debounce or disconnect flush) runs

    row = db.fetch_one("SELECT ydoc_state FROM pages WHERE id = %s", (page["id"],))
    assert row[0] is not None, "the edit was never persisted (dirty lost)"
    stored_doc = Doc()
    stored_doc.apply_update(row[0])
    assert "edit-during-outage" in _doc_text(stored_doc)


def _await_flushed(db: Database, page_id: str, needle: str) -> None:
    """Wait until the debounce loop has persisted ``needle`` (tick just ran)."""
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        row = db.fetch_one("SELECT content_text FROM pages WHERE id = %s", (page_id,))
        if needle in (row[0] or ""):
            return
        time.sleep(0.05)
    raise AssertionError(f"{needle!r} was never flushed")


# --- write access is re-checked while the socket is open (review finding 2) -----


def test_trash_while_socket_open_stops_the_writes(
    server: LiveServer, auth_client: httpx.Client, db: Database
) -> None:
    """A page trashed after connect must not accept further edits.

    The spec allows an open socket to stay connected, but the trashed page is
    read-only: pushes that arrive after the delete are dropped, and only the
    pre-trash edits are stored.
    """
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as conn:
        doc, _ = doc_with_text()
        yjs_sync(conn, doc)
        _edit(doc, "before the trash")
        yjs_send_update(conn, doc)
        yjs_wait_for(conn, doc, "before the trash")
        _await_flushed(db, page["id"], "before the trash")  # stored before the delete
        assert auth_client.delete(f"/pages/{page['id']}").status_code == 204
        _edit(doc, "typed after the trash")
        yjs_send_update(conn, doc)
        time.sleep(0.3)  # the push is served (and dropped) by then
        assert auth_client.post(f"/pages/{page['id']}/restore").status_code == 200
    time.sleep(FLUSH_WAIT_S)

    stored = auth_client.get(f"/pages/{page['id']}/document").json()
    stored_doc = Doc()
    stored_doc.apply_update(base64.b64decode(stored["state"]))
    text = _doc_text(stored_doc)
    assert "before the trash" in text
    assert "typed after the trash" not in text


def test_demotion_while_socket_open_stops_the_writes(
    server: LiveServer,
    auth_client: httpx.Client,
    db: Database,
    register_user: Callable[..., RegisteredUser],
) -> None:
    """An editor demoted to viewer after connect must not write either."""

    workspace = create_workspace(auth_client)
    editor = make_member(register_user, auth_client, workspace["id"], role="editor")
    page = create_page(auth_client, workspace["id"])
    url = _collab_url(server, page["id"], editor.session_id)

    with connect(url, open_timeout=5) as conn:
        doc, _ = doc_with_text()
        yjs_sync(conn, doc)
        _edit(doc, "as an editor")
        yjs_send_update(conn, doc)
        yjs_wait_for(conn, doc, "as an editor")
        _await_flushed(db, page["id"], "as an editor")  # stored before the demotion
        member_id = next(
            member["user_id"]
            for member in auth_client.get(
                f"/workspaces/{workspace['id']}/members"
            ).json()
            if member["user_id"] == editor.id
        )
        assert (
            auth_client.patch(
                f"/workspaces/{workspace['id']}/members/{member_id}",
                json={"role": "viewer"},
            ).status_code
            == 200
        )
        _edit(doc, "typed as a viewer")
        yjs_send_update(conn, doc)
        time.sleep(0.3)  # the push is served (and dropped) by then
    time.sleep(FLUSH_WAIT_S)

    stored = auth_client.get(f"/pages/{page['id']}/document").json()
    stored_doc = Doc()
    stored_doc.apply_update(base64.b64decode(stored["state"]))
    text = _doc_text(stored_doc)
    assert "as an editor" in text
    assert "typed as a viewer" not in text


# --- last_edited_by names only real document updates (review finding 8) ---------


def test_merely_opening_the_page_does_not_take_over_last_edited_by(
    server: LiveServer,
    auth_client: httpx.Client,
    register_user: Callable[..., RegisteredUser],
) -> None:
    """``last_edited_by`` is the user who last sent a document update.

    A second editor's initial sync (asking for the document, answering with
    an empty state) is not a document update: the flush must still credit
    the user who typed.
    """
    workspace = create_workspace(auth_client)
    other_editor = make_member(
        register_user, auth_client, workspace["id"], role="editor"
    )
    page = create_page(auth_client, workspace["id"])
    owner_url = _collab_url(server, page["id"], _token_of(auth_client))
    other_url = _collab_url(server, page["id"], other_editor.session_id)
    owner_id = auth_client.get("/users/me").json()["id"]

    with connect(owner_url, open_timeout=5) as conn_a:
        doc_a, _ = doc_with_text()
        yjs_sync(conn_a, doc_a)
        _edit(doc_a, "typed by the owner")
        yjs_send_update(conn_a, doc_a)
        yjs_wait_for(conn_a, doc_a, "typed by the owner")
        with connect(other_url, open_timeout=5) as conn_b:  # the mere open
            doc_b, _ = doc_with_text()
            yjs_sync(conn_b, doc_b)
            yjs_wait_for(conn_b, doc_b, "typed by the owner")
    time.sleep(FLUSH_WAIT_S)  # the debounce flush runs after B's sync

    detail = auth_client.get(f"/pages/{page['id']}").json()
    assert detail["last_edited_by"]["id"] == owner_id
