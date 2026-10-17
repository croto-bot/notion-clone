"""Favorites: star a page, list them, unstar."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.helpers import assert_error, create_page, create_workspace, make_member

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser


def test_favorite_and_list_by_position(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    first = create_page(auth_client, workspace["id"], title="First")
    second = create_page(auth_client, workspace["id"], title="Second")

    assert auth_client.put(f"/pages/{first['id']}/favorite").status_code == 204
    assert auth_client.put(f"/pages/{second['id']}/favorite").status_code == 204

    favorites = auth_client.get(f"/workspaces/{workspace['id']}/favorites").json()
    assert [page["title"] for page in favorites] == ["First", "Second"]
    detail = auth_client.get(f"/pages/{first['id']}").json()
    assert detail["is_favorite"] is True


def test_unfavorite(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    auth_client.put(f"/pages/{page['id']}/favorite")

    assert auth_client.delete(f"/pages/{page['id']}/favorite").status_code == 204

    assert auth_client.get(f"/workspaces/{workspace['id']}/favorites").json() == []
    assert auth_client.get(f"/pages/{page['id']}").json()["is_favorite"] is False


def test_unfavorite_is_idempotent(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    assert auth_client.delete(f"/pages/{page['id']}/favorite").status_code == 204


def test_favorites_are_per_user_and_per_workspace(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    other_workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    other_page = create_page(auth_client, other_workspace["id"])
    editor = make_member(register_user, auth_client, workspace["id"])

    auth_client.put(f"/pages/{page['id']}/favorite")
    auth_client.put(f"/pages/{other_page['id']}/favorite")
    editor.client.put(f"/pages/{page['id']}/favorite")

    mine = auth_client.get(f"/workspaces/{workspace['id']}/favorites").json()
    assert [p["title"] for p in mine] == [page["title"]]

    theirs = editor.client.get(f"/workspaces/{workspace['id']}/favorites").json()
    assert [p["title"] for p in theirs] == [page["title"]]

    everywhere = auth_client.get(
        f"/workspaces/{other_workspace['id']}/favorites"
    ).json()
    assert [p["title"] for p in everywhere] == [other_page["title"]]


def test_trashed_pages_leave_the_favorites_list(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    auth_client.put(f"/pages/{page['id']}/favorite")

    auth_client.delete(f"/pages/{page['id']}")

    assert auth_client.get(f"/workspaces/{workspace['id']}/favorites").json() == []


# --- roles (review finding 7) ----------------------------------------------------


def test_viewer_cannot_favorite(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """The spec's viewer contract: 403 forbidden on every write but comments."""
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")
    page = create_page(auth_client, workspace["id"])

    assert_error(viewer.client.put(f"/pages/{page['id']}/favorite"), 403, "forbidden")
    assert auth_client.get(f"/workspaces/{workspace['id']}/favorites").json() == []


def test_viewer_cannot_unfavorite(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """Removing a favorite is a write too: a viewer gets 403."""
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")
    page = create_page(auth_client, workspace["id"])
    assert auth_client.put(f"/pages/{page['id']}/favorite").status_code == 204

    assert_error(viewer.client.delete(f"/pages/{page['id']}/favorite"), 403, "forbidden")

    favorites = auth_client.get(f"/workspaces/{workspace['id']}/favorites").json()
    assert [p["id"] for p in favorites] == [page["id"]]
