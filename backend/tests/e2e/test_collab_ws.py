"""The collab WebSocket: y-websocket sync, persistence, read-only clients."""

from __future__ import annotations

import base64
import time
from typing import TYPE_CHECKING

from pycrdt import Doc, XmlElement, XmlFragment, XmlText
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from tests.e2e.helpers import (
    create_page,
    create_workspace,
    doc_with_text,
    make_member,
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
    from tests.e2e.stack import LiveServer

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
            assert "Typed by client A" in _doc_text(doc_b)

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
        assert "Owner text" in _doc_text(viewer_doc)  # viewers still read

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
