"""The workspace events WebSocket: live updates for members."""

from __future__ import annotations

import base64
import json
import time
from typing import TYPE_CHECKING

from pycrdt import XmlElement, XmlFragment, XmlText
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from tests.e2e.helpers import (
    create_page,
    create_workspace,
    doc_with_text,
    make_member,
    ws_close_code,
    yjs_send_update,
    yjs_sync,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import LiveServer


def _events_url(server: LiveServer, workspace_id: str, token: str) -> str:
    return (
        f"{server.base_url.replace('http://', 'ws://')}"
        f"/workspaces/{workspace_id}/events?token={token}"
    )


def _token_of(client: httpx.Client) -> str:
    return client.headers["Authorization"].removeprefix("Bearer ")


def _next_event(connection: object) -> dict[str, str]:
    message = connection.recv(timeout=5)
    return json.loads(message)


def test_page_lifecycle_events(server: LiveServer, auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    url = _events_url(server, workspace["id"], _token_of(auth_client))
    me = auth_client.get("/users/me").json()

    with connect(url, open_timeout=5) as socket:
        page = create_page(auth_client, workspace["id"])
        created = _next_event(socket)
        assert created == {
            "type": "page.created",
            "page_id": page["id"],
            "actor_id": me["id"],
        }

        auth_client.patch(f"/pages/{page['id']}", json={"title": "Renamed"})
        assert _next_event(socket)["type"] == "page.updated"

        auth_client.post(f"/pages/{page['id']}/move", json={"parent_id": None})
        assert _next_event(socket)["type"] == "page.moved"

        auth_client.delete(f"/pages/{page['id']}")
        assert _next_event(socket)["type"] == "page.deleted"

        auth_client.post(f"/pages/{page['id']}/restore")
        assert _next_event(socket)["type"] == "page.restored"

        auth_client.delete(f"/pages/{page['id']}")
        assert _next_event(socket)["type"] == "page.deleted"
        auth_client.delete(f"/pages/{page['id']}/permanent")
        assert _next_event(socket)["type"] == "page.purged"

        # Duplicating publishes page.created for the copy.
        fresh = create_page(auth_client, workspace["id"])
        _next_event(socket)  # page.created of the fresh page
        copy = auth_client.post(f"/pages/{fresh['id']}/duplicate")
        assert copy.status_code == 201
        event = _next_event(socket)
        assert event["type"] == "page.created"
        assert event["page_id"] == copy.json()["id"]


def test_comment_events(server: LiveServer, auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _events_url(server, workspace["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as socket:
        comment = auth_client.post(
            f"/pages/{page['id']}/comments", json={"body": "Eventful"}
        ).json()
        event = _next_event(socket)
        assert event["type"] == "comment.changed"
        assert event["page_id"] == page["id"]

        auth_client.patch(f"/comments/{comment['id']}", json={"resolved": True})
        assert _next_event(socket)["type"] == "comment.changed"

        auth_client.delete(f"/comments/{comment['id']}")
        assert _next_event(socket)["type"] == "comment.changed"


def test_workspace_and_member_events(
    server: LiveServer,
    auth_client: httpx.Client,
    register_user: Callable[..., RegisteredUser],
) -> None:
    workspace = create_workspace(auth_client)
    member = register_user()
    url = _events_url(server, workspace["id"], _token_of(auth_client))

    with connect(url, open_timeout=5) as socket:
        auth_client.patch(f"/workspaces/{workspace['id']}", json={"name": "New name"})
        assert _next_event(socket)["type"] == "workspace.updated"

        auth_client.post(
            f"/workspaces/{workspace['id']}/members",
            json={"email": member.email, "role": "editor"},
        )
        event = _next_event(socket)
        assert event["type"] == "members.changed"
        assert event["actor_id"] == auth_client.get("/users/me").json()["id"]


def test_every_member_receives_events(
    server: LiveServer,
    auth_client: httpx.Client,
    register_user: Callable[..., RegisteredUser],
) -> None:
    workspace = create_workspace(auth_client)
    editor = make_member(register_user, auth_client, workspace["id"])
    owner_url = _events_url(server, workspace["id"], _token_of(auth_client))
    editor_url = _events_url(server, workspace["id"], editor.session_id)

    with (
        connect(owner_url, open_timeout=5) as owner_socket,
        connect(editor_url, open_timeout=5) as editor_socket,
    ):
        page = create_page(editor.client, workspace["id"])
        owner_event = _next_event(owner_socket)
        editor_event = _next_event(editor_socket)
        assert owner_event == editor_event
        assert owner_event["page_id"] == page["id"]
        assert owner_event["actor_id"] == editor.id


def test_events_carry_the_mutating_tab_client_id(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    """A UUID `X-Client-Id` is echoed as `client_id`. Anything else is dropped."""
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    url = _events_url(server, workspace["id"], _token_of(auth_client))
    tab = "11111111-1111-4111-8111-111111111111"

    with connect(url, open_timeout=5) as socket:
        auth_client.patch(
            f"/pages/{page['id']}",
            json={"title": "From a tab"},
            headers={"X-Client-Id": tab},
        )
        event = _next_event(socket)
        assert event["type"] == "page.updated"
        assert event["client_id"] == tab

        # No header (a client that predates it, or any script): no client_id.
        auth_client.patch(f"/pages/{page['id']}", json={"title": "From a script"})
        assert "client_id" not in _next_event(socket)

        # Not a UUID: dropped, not truncated. A partial id could alias a tab.
        auth_client.patch(
            f"/pages/{page['id']}",
            json={"title": "Not a uuid"},
            headers={"X-Client-Id": "tab-1"},
        )
        assert "client_id" not in _next_event(socket)


def test_collab_save_echoes_the_tab_client_id(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    """A document save publishes `page.updated` with the collab socket's tab id."""
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    tab = "22222222-2222-4222-8222-222222222222"
    events = _events_url(server, workspace["id"], _token_of(auth_client))
    collab = (
        f"{server.base_url.replace('http://', 'ws://')}"
        f"/pages/{page['id']}/collab?token={_token_of(auth_client)}&client_id={tab}"
    )

    with connect(events, open_timeout=5) as socket:
        with connect(collab, open_timeout=5) as conn:
            doc, _ = doc_with_text()
            yjs_sync(conn, doc)
            fragment = doc.get("document-store", type=XmlFragment)
            with doc.transaction():
                fragment.children.append(
                    XmlElement("p", contents=[XmlText("from collab")])
                )
            yjs_send_update(conn, doc)
        event = _next_event(socket)

    assert event["type"] == "page.updated"
    assert event["page_id"] == page["id"]
    assert event["client_id"] == tab


def test_collab_save_drops_a_non_uuid_client_id(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    events = _events_url(server, workspace["id"], _token_of(auth_client))
    collab = (
        f"{server.base_url.replace('http://', 'ws://')}"
        f"/pages/{page['id']}/collab?token={_token_of(auth_client)}&client_id=not-a-uuid"
    )

    with connect(events, open_timeout=5) as socket:
        with connect(collab, open_timeout=5) as conn:
            doc, _ = doc_with_text()
            yjs_sync(conn, doc)
            fragment = doc.get("document-store", type=XmlFragment)
            with doc.transaction():
                fragment.children.append(XmlElement("p", contents=[XmlText("no tab")]))
            yjs_send_update(conn, doc)
        event = _next_event(socket)

    assert event["type"] == "page.updated"
    assert "client_id" not in event


def test_put_document_with_an_open_room_publishes_once(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    """The PUT and the room's flush of the same change are one `page.updated`."""
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    tab = "33333333-3333-4333-8333-333333333333"
    events = _events_url(server, workspace["id"], _token_of(auth_client))
    collab = (
        f"{server.base_url.replace('http://', 'ws://')}"
        f"/pages/{page['id']}/collab?token={_token_of(auth_client)}"
    )
    _doc, update = doc_with_text("put while the room is open")

    with connect(events, open_timeout=5) as socket:
        with connect(collab, open_timeout=5) as conn:
            doc, _ = doc_with_text()
            yjs_sync(conn, doc)
            response = auth_client.put(
                f"/pages/{page['id']}/document",
                json={"state": base64.b64encode(update).decode()},
                headers={"X-Client-Id": tab},
            )
            assert response.status_code == 200, response.text
            # Longer than two flush intervals: a second event would be here.
            received: list[dict[str, str]] = []
            deadline = time.monotonic() + 3
            while (left := deadline - time.monotonic()) > 0:
                try:
                    received.append(json.loads(socket.recv(timeout=left)))
                except TimeoutError:
                    break

    updates = [event for event in received if event["type"] == "page.updated"]
    assert len(updates) == 1, received
    assert updates[0]["page_id"] == page["id"]
    assert updates[0]["client_id"] == tab


def test_bad_token_closes_4401(server: LiveServer, auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    url = _events_url(server, workspace["id"], "s_not-a-real-token")

    with connect(url, open_timeout=5) as socket:
        try:
            socket.recv(timeout=5)
            raise AssertionError("the socket was not closed")
        except ConnectionClosed as exc:
            assert ws_close_code(exc) == 4401


def test_non_member_closes_4404(
    server: LiveServer,
    auth_client: httpx.Client,
    register_user: Callable[..., RegisteredUser],
) -> None:
    workspace = create_workspace(auth_client)
    stranger = register_user()
    url = _events_url(server, workspace["id"], stranger.session_id)

    with connect(url, open_timeout=5) as socket:
        try:
            socket.recv(timeout=5)
            raise AssertionError("the socket was not closed")
        except ConnectionClosed as exc:
            assert ws_close_code(exc) == 4404
