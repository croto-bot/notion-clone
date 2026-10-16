"""The workspace events WebSocket: live updates for members."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from tests.e2e.helpers import (
    create_page,
    create_workspace,
    make_member,
    ws_close_code,
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
