"""Workspace CRUD and access rules."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from tests.e2e.helpers import (
    assert_error,
    create_workspace,
    held_db_lock,
    make_member,
    unique_email,
    wait_for_blocked_queries,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import Database


def test_create_returns_the_workspace_with_owner_role(
    auth_client: httpx.Client,
) -> None:
    response = auth_client.post("/workspaces", json={"name": "My Notion", "icon": "🏠"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "My Notion"
    assert body["icon"] == "🏠"
    assert body["role"] == "owner"
    assert body["owner_id"]
    follow_up = auth_client.get(f"/workspaces/{body['id']}")
    assert follow_up.status_code == 200
    assert follow_up.json() == body


def test_list_shows_only_my_workspaces_with_my_role(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    mine = create_workspace(auth_client, name="Mine")
    theirs = create_workspace(register_user().client, name="Theirs")

    listed = auth_client.get("/workspaces").json()

    assert [workspace["id"] for workspace in listed] == [mine["id"]]
    assert listed[0]["role"] == "owner"
    assert theirs["id"] not in [workspace["id"] for workspace in listed]


def test_rename_is_owner_only(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    editor = make_member(register_user, auth_client, workspace["id"], role="editor")

    renamed = auth_client.patch(
        f"/workspaces/{workspace['id']}", json={"name": "Renamed", "icon": "✨"}
    )
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["icon"]) == ("Renamed", "✨")

    refused = editor.client.patch(
        f"/workspaces/{workspace['id']}", json={"name": "Nope"}
    )
    assert_error(refused, 403, "forbidden")


def test_delete_is_owner_only(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    editor = make_member(register_user, auth_client, workspace["id"], role="editor")

    assert_error(
        editor.client.delete(f"/workspaces/{workspace['id']}"), 403, "forbidden"
    )
    assert auth_client.delete(f"/workspaces/{workspace['id']}").status_code == 204
    assert_error(auth_client.get(f"/workspaces/{workspace['id']}"), 404, "not_found")


def test_non_member_gets_404_like_a_missing_workspace(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(register_user().client)
    detail = f"Workspace {workspace['id']} not found"

    assert_error(
        auth_client.get(f"/workspaces/{workspace['id']}"), 404, "not_found", detail
    )
    assert_error(
        auth_client.patch(f"/workspaces/{workspace['id']}", json={"name": "x"}),
        404,
        "not_found",
        detail,
    )
    assert_error(
        auth_client.delete(f"/workspaces/{workspace['id']}"), 404, "not_found", detail
    )
    assert_error(
        auth_client.get(f"/workspaces/{workspace['id']}/members"),
        404,
        "not_found",
        detail,
    )


def test_name_validation(auth_client: httpx.Client) -> None:
    for name in ("", "x" * 101):
        response = auth_client.post("/workspaces", json={"name": name})
        assert response.status_code == 422, response.text
    assert auth_client.post("/workspaces", json={"name": "x" * 100}).status_code == 201


def test_requires_a_session(api: httpx.Client) -> None:
    assert_error(api.get("/workspaces"), 403, "http_error", "Not authenticated")


def test_unknown_user_cannot_be_found_by_email(auth_client: httpx.Client) -> None:
    # Coverage for the user lookup path of member adds lives in test_members.

    workspace = create_workspace(auth_client)
    response = auth_client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": unique_email("ghost"), "role": "viewer"},
    )
    assert_error(response, 404, "user_not_found")


def test_get_racing_the_workspace_delete_is_404(
    auth_client: httpx.Client, db: Database
) -> None:
    """The membership is read first, then the workspace: a delete that commits
    between the two reads answers 404, not 500.

    A held table lock parks the workspace read after the membership read;
    the lock holder deletes the workspace (its members go with it).
    """
    workspace = create_workspace(auth_client)
    box: dict[str, Any] = {}

    def _get() -> None:
        box["response"] = auth_client.get(f"/workspaces/{workspace['id']}")

    with held_db_lock(db, "LOCK TABLE workspaces IN ACCESS EXCLUSIVE MODE") as conn:
        thread = threading.Thread(target=_get)
        thread.start()
        wait_for_blocked_queries(db, count=1, needle="FROM workspaces")
        conn.execute("DELETE FROM workspaces WHERE id = %s", (workspace["id"],))
    thread.join(timeout=30)

    assert_error(
        box["response"], 404, "not_found", f"Workspace {workspace['id']} not found"
    )
    assert auth_client.get("/workspaces").json() == []
