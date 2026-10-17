"""Trash: delete a subtree, restore it, purge it forever."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from tests.e2e.helpers import assert_error, create_page, create_workspace

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import Database


def test_delete_moves_the_subtree_to_trash(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    child = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Child"
    )

    response = auth_client.delete(f"/pages/{parent['id']}")

    assert response.status_code == 204
    parent_now = auth_client.get(f"/pages/{parent['id']}").json()
    child_now = auth_client.get(f"/pages/{child['id']}").json()
    assert parent_now["deleted_at"] is not None
    assert child_now["deleted_at"] is not None

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert [page["title"] for page in tree] == []


def test_trash_lists_deleted_roots_newest_first(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    older = create_page(auth_client, workspace["id"], title="Older")
    newer = create_page(auth_client, workspace["id"], title="Newer")
    auth_client.delete(f"/pages/{older['id']}")
    auth_client.delete(f"/pages/{newer['id']}")

    trash = auth_client.get(f"/workspaces/{workspace['id']}/trash").json()

    assert [page["title"] for page in trash] == ["Newer", "Older"]


def test_trash_search_filters_by_title(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    create_page(auth_client, workspace["id"], title="Quarterly report")
    create_page(auth_client, workspace["id"], title="Grocery list")
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    for page in tree:
        auth_client.delete(f"/pages/{page['id']}")

    found = auth_client.get(
        f"/workspaces/{workspace['id']}/trash", params={"q": "quarterly"}
    ).json()

    assert [page["title"] for page in found] == ["Quarterly report"]


def test_trashed_page_is_read_only_for_writes(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    auth_client.delete(f"/pages/{page['id']}")

    response = auth_client.patch(f"/pages/{page['id']}", json={"title": "X"})

    assert_error(response, 400, "page_in_trash")


def test_restore_the_whole_subtree(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    child = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Child"
    )
    auth_client.delete(f"/pages/{parent['id']}")

    response = auth_client.post(f"/pages/{parent['id']}/restore")

    assert response.status_code == 200
    assert response.json()["deleted_at"] is None
    child_now = auth_client.get(f"/pages/{child['id']}").json()
    assert child_now["deleted_at"] is None
    assert child_now["parent_id"] == parent["id"]
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert {page["title"] for page in tree} == {"Parent", "Child"}


def test_restore_to_root_when_the_parent_is_trashed(
    auth_client: httpx.Client,
) -> None:
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    child = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Child"
    )
    auth_client.delete(f"/pages/{parent['id']}")

    restored = auth_client.post(f"/pages/{child['id']}/restore").json()

    assert restored["parent_id"] is None


def test_purge_removes_the_subtree_forever(
    auth_client: httpx.Client, db: Database
) -> None:
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    child = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Child"
    )
    auth_client.delete(f"/pages/{parent['id']}")

    response = auth_client.delete(f"/pages/{parent['id']}/permanent")

    assert response.status_code == 204
    assert_error(auth_client.get(f"/pages/{parent['id']}"), 404, "not_found")
    assert_error(auth_client.get(f"/pages/{child['id']}"), 404, "not_found")
    assert db.fetch_one("SELECT count(*) FROM pages")[0] == 0, (
        "the purge must remove the whole subtree"
    )


def test_purge_only_trashed_pages(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    response = auth_client.delete(f"/pages/{page['id']}/permanent")

    assert_error(response, 409, "not_in_trash")


def test_viewer_cannot_trash_or_restore(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    from tests.e2e.helpers import make_member

    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")
    page = create_page(auth_client, workspace["id"])

    assert_error(viewer.client.delete(f"/pages/{page['id']}"), 403, "forbidden")
    auth_client.delete(f"/pages/{page['id']}")
    assert_error(viewer.client.post(f"/pages/{page['id']}/restore"), 403, "forbidden")


# --- a separate trash item inside a trashed tree (review finding 3) --------------


def _nested_with_trashed_child(auth_client: httpx.Client) -> dict[str, Any]:
    """Parent -> Child -> Grandchild, with Child trashed before Parent."""
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    child = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Child"
    )
    grandchild = create_page(
        auth_client, workspace["id"], parent_id=child["id"], title="Grandchild"
    )
    assert auth_client.delete(f"/pages/{child['id']}").status_code == 204
    assert auth_client.delete(f"/pages/{parent['id']}").status_code == 204
    return {
        "workspace": workspace,
        "parent": parent,
        "child": child,
        "grandchild": grandchild,
    }


def test_restore_keeps_a_separately_trashed_child_in_trash(
    auth_client: httpx.Client,
) -> None:
    """Restoring the parent must not restore a child with its own trash item.

    The child (and its own subtree) was trashed before the parent, so it keeps
    its trash entry; only the pages trashed by the parent's delete come back.
    """
    pages = _nested_with_trashed_child(auth_client)
    workspace, parent, child, grandchild = (
        pages["workspace"],
        pages["parent"],
        pages["child"],
        pages["grandchild"],
    )

    response = auth_client.post(f"/pages/{parent['id']}/restore")

    assert response.status_code == 200
    assert response.json()["deleted_at"] is None
    assert auth_client.get(f"/pages/{child['id']}").json()["deleted_at"] is not None
    assert (
        auth_client.get(f"/pages/{grandchild['id']}").json()["deleted_at"] is not None
    )
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert [page["title"] for page in tree] == ["Parent"]
    trash = auth_client.get(f"/workspaces/{workspace['id']}/trash").json()
    assert [page["title"] for page in trash] == ["Child"]


def test_purge_keeps_a_separately_trashed_child(
    auth_client: httpx.Client, db: Database
) -> None:
    """Purging the parent must not forever delete a child with its own trash item.

    The child's trash entry is independent: it survives the purge, moved to
    the workspace root and still trashed.
    """
    pages = _nested_with_trashed_child(auth_client)
    workspace, parent, child, grandchild = (
        pages["workspace"],
        pages["parent"],
        pages["child"],
        pages["grandchild"],
    )

    response = auth_client.delete(f"/pages/{parent['id']}/permanent")

    assert response.status_code == 204
    assert_error(auth_client.get(f"/pages/{parent['id']}"), 404, "not_found")
    child_now = auth_client.get(f"/pages/{child['id']}").json()
    assert child_now["deleted_at"] is not None
    assert child_now["parent_id"] is None
    assert (
        auth_client.get(f"/pages/{grandchild['id']}").json()["deleted_at"] is not None
    )
    assert (
        auth_client.get(f"/pages/{grandchild['id']}").json()["parent_id"] == child["id"]
    )
    trash = auth_client.get(f"/workspaces/{workspace['id']}/trash").json()
    assert [page["title"] for page in trash] == ["Child"]
    assert db.fetch_one("SELECT count(*) FROM pages")[0] == 2
