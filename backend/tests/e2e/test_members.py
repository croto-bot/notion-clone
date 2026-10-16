"""Members and roles: add, change, remove, leave, last-owner protection."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.helpers import assert_error, create_workspace, make_member

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser


def test_add_member_by_email(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    user = register_user(display_name=" teammate ")

    response = auth_client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": user.email, "role": "editor"},
    )

    assert response.status_code == 201
    member = response.json()
    assert member["user_id"] == user.id
    assert member["email"] == user.email
    assert member["role"] == "editor"
    assert member["joined_at"]

    members = auth_client.get(f"/workspaces/{workspace['id']}/members").json()
    assert {(m["email"], m["role"]) for m in members} == {
        (user.email, "editor"),
        (auth_client.get("/users/me").json()["email"], "owner"),
    }


def test_add_member_with_unknown_email_is_404(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)

    response = auth_client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": "ghost-user@example.com", "role": "viewer"},
    )

    assert_error(response, 404, "user_not_found")


def test_adding_an_existing_member_conflicts(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    user = make_member(register_user, auth_client, workspace["id"])

    response = auth_client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": user.email, "role": "viewer"},
    )

    assert_error(response, 409, "already_member")


def test_only_the_owner_manages_members(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    editor = make_member(register_user, auth_client, workspace["id"], role="editor")
    someone = register_user()

    add = editor.client.post(
        f"/workspaces/{workspace['id']}/members",
        json={"email": someone.email, "role": "viewer"},
    )
    assert_error(add, 403, "forbidden")

    change = editor.client.patch(
        f"/workspaces/{workspace['id']}/members/{editor.id}", json={"role": "viewer"}
    )
    assert_error(change, 403, "forbidden")

    remove = editor.client.delete(f"/workspaces/{workspace['id']}/members/{editor.id}")
    assert remove.status_code == 204  # a member may always leave


def test_change_role(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    member = make_member(register_user, auth_client, workspace["id"], role="editor")

    response = auth_client.patch(
        f"/workspaces/{workspace['id']}/members/{member.id}",
        json={"role": "viewer"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    members = auth_client.get(f"/workspaces/{workspace['id']}/members").json()
    assert next(m for m in members if m["user_id"] == member.id)["role"] == "viewer"


def test_the_last_owner_cannot_lose_the_owner_role(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    me = auth_client.get("/users/me").json()

    response = auth_client.patch(
        f"/workspaces/{workspace['id']}/members/{me['id']}", json={"role": "editor"}
    )

    assert_error(response, 409, "last_owner")


def test_the_last_owner_cannot_leave(
    auth_client: httpx.Client,
    register_user: Callable[..., RegisteredUser],
) -> None:
    workspace = create_workspace(auth_client)
    me = auth_client.get("/users/me").json()

    response = auth_client.delete(f"/workspaces/{workspace['id']}/members/{me['id']}")

    assert_error(response, 409, "last_owner")


def test_another_owner_can_take_over(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    me = auth_client.get("/users/me").json()
    other = make_member(register_user, auth_client, workspace["id"], role="editor")

    promoted = auth_client.patch(
        f"/workspaces/{workspace['id']}/members/{other.id}", json={"role": "owner"}
    )
    assert promoted.json()["role"] == "owner"

    demoted = auth_client.patch(
        f"/workspaces/{workspace['id']}/members/{me['id']}", json={"role": "editor"}
    )
    assert demoted.status_code == 200


def test_remove_member_and_leave(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")

    removed = auth_client.delete(f"/workspaces/{workspace['id']}/members/{viewer.id}")
    assert removed.status_code == 204
    assert_error(viewer.client.get(f"/workspaces/{workspace['id']}"), 404, "not_found")

    editor = make_member(register_user, auth_client, workspace["id"])
    left = editor.client.delete(f"/workspaces/{workspace['id']}/members/{editor.id}")
    assert left.status_code == 204
    assert_error(editor.client.get(f"/workspaces/{workspace['id']}"), 404, "not_found")


def test_membership_gives_the_workspace_role_in_workspaces(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")

    listed = viewer.client.get("/workspaces").json()

    assert [w["role"] for w in listed if w["id"] == workspace["id"]] == ["viewer"]
