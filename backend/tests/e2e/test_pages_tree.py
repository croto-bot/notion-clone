"""The page tree: create, ordering, visibility."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from tests.e2e.helpers import (
    assert_error,
    create_page,
    create_workspace,
    make_member,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import Database


def test_create_root_page(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)

    page = create_page(auth_client, workspace["id"], title="First page", icon="📄")

    got = auth_client.get(f"/pages/{page['id']}").json()
    assert got["title"] == "First page"
    assert got["icon"] == "📄"
    assert got["workspace_id"] == workspace["id"]
    assert got["parent_id"] is None
    assert got["kind"] == "page"
    assert got["role"] == "owner"
    assert got["breadcrumbs"] == []
    assert got["created_by"]["email"] == auth_client.get("/users/me").json()["email"]
    assert got["is_favorite"] is False


def test_create_child_page_and_breadcrumbs(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    root = create_page(auth_client, workspace["id"], title="Root", icon="🌳")
    child = create_page(
        auth_client, workspace["id"], parent_id=root["id"], title="Child"
    )
    grandchild = create_page(
        auth_client, workspace["id"], parent_id=child["id"], title="Grandchild"
    )

    got = auth_client.get(f"/pages/{grandchild['id']}").json()

    assert [b["title"] for b in got["breadcrumbs"]] == ["Root", "Child"]
    assert [b["id"] for b in got["breadcrumbs"]] == [root["id"], child["id"]]
    assert got["breadcrumbs"][0]["icon"] == "🌳"


def test_pages_order_by_position(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    first = create_page(auth_client, workspace["id"], title="First")
    create_page(auth_client, workspace["id"], title="Last")  # no after_id: goes last
    create_page(auth_client, workspace["id"], title="Middle", after_id=first["id"])
    create_page(auth_client, workspace["id"], title="Also last")
    create_page(auth_client, workspace["id"], title="On top", after_id=None)

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()

    assert [page["title"] for page in tree] == [
        "On top",  # after_id null = first
        "First",
        "Middle",
        "Last",
        "Also last",
    ]
    positions = [page["position"] for page in tree]
    assert positions == sorted(positions)


def test_new_pages_go_last_by_default(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    create_page(auth_client, workspace["id"], title="A")
    create_page(auth_client, workspace["id"], title="B")

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()

    assert [page["title"] for page in tree] == ["A", "B"]


def test_tree_reports_has_children(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    create_page(auth_client, workspace["id"], parent_id=parent["id"], title="Child")

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()

    flags = {page["title"]: page["has_children"] for page in tree}
    assert flags["Parent"] is True
    assert flags["Child"] is False


def test_tree_excludes_trashed_and_database_rows(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    create_page(auth_client, workspace["id"], title="Keep")
    gone = create_page(auth_client, workspace["id"], title="Gone")
    database = create_page(auth_client, workspace["id"], kind="database", title="DB")
    create_page(auth_client, workspace["id"], parent_id=database["id"], title="Row")
    auth_client.delete(f"/pages/{gone['id']}")

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()

    titles = [page["title"] for page in tree]
    assert "Gone" not in titles
    assert "Row" not in titles
    assert set(titles) == {"Keep", "DB"}


def test_viewer_cannot_create_pages(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")

    response = viewer.client.post(
        "/pages", json={"workspace_id": workspace["id"], "title": "Nope"}
    )

    assert_error(response, 403, "forbidden")
    assert (
        viewer.client.get(
            f"/pages/{create_page(auth_client, workspace['id'])['id']}"
        ).status_code
        == 200
    )


def test_editor_can_create_pages(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    editor = make_member(register_user, auth_client, workspace["id"], role="editor")

    page = create_page(editor.client, workspace["id"], title="By editor")

    assert editor.client.get(f"/pages/{page['id']}").json()["role"] == "editor"
    assert auth_client.get(f"/pages/{page['id']}").json()["role"] == "owner"


def test_non_member_sees_no_pages(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    stranger = register_user().client
    detail = f"Page {page['id']} not found"

    assert_error(stranger.get(f"/pages/{page['id']}"), 404, "not_found", detail)
    assert_error(
        stranger.get(f"/workspaces/{workspace['id']}/page-tree"),
        404,
        "not_found",
        f"Workspace {workspace['id']} not found",
    )
    assert_error(
        stranger.post("/pages", json={"workspace_id": workspace["id"]}),
        404,
        "not_found",
        f"Workspace {workspace['id']} not found",
    )


def test_missing_parent_is_404(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)

    response = auth_client.post(
        "/pages",
        json={
            "workspace_id": workspace["id"],
            "parent_id": "00000000-0000-4000-8000-000000000000",
        },
    )

    assert_error(response, 404, "not_found")


def test_get_missing_page_is_404(auth_client: httpx.Client) -> None:
    response = auth_client.get("/pages/00000000-0000-4000-8000-000000000000")

    assert_error(response, 404, "not_found")


# --- sibling position collisions (review finding 9) ------------------------------


def test_corrupt_sibling_keys_are_invalid_move_not_500(
    auth_client: httpx.Client, db: Database
) -> None:
    """A key the fractional indexer rejects maps to 400 invalid_move.

    The db fixture corrupts one sibling's order key the way a lost position
    race leaves rows (a key generate_key_between cannot order): creating and
    moving around it must not 500.
    """
    workspace = create_workspace(auth_client)
    a = create_page(auth_client, workspace["id"], title="A")
    b = create_page(auth_client, workspace["id"], title="B")
    c = create_page(auth_client, workspace["id"], title="C")
    # "a00" is an invalid fractional key (trailing zero); it sorts after "a0",
    # so any insert between A and B feeds both bounds to the key generator.
    assert db.execute("UPDATE pages SET position = 'a00' WHERE id = %s", (b["id"],))

    created = auth_client.post(
        "/pages",
        json={"workspace_id": workspace["id"], "title": "D", "after_id": a["id"]},
    )
    assert_error(created, 400, "invalid_move")

    moved = auth_client.post(
        f"/pages/{c['id']}/move",
        json={"parent_id": None, "after_id": a["id"]},
    )
    assert_error(moved, 400, "invalid_move")


def test_concurrent_creates_under_one_parent_get_distinct_positions(
    auth_client: httpx.Client, db: Database
) -> None:
    """Two creates that race for the same slot converge on distinct keys.

    Every creator computes a position from the siblings it can see; the
    unique sibling index rejects a taken slot and the create retries with a
    fresh key, so all four pages land, each on its own position.
    """
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    failures: list[Any] = []

    def _create() -> None:
        response = auth_client.post(
            "/pages",
            json={
                "workspace_id": workspace["id"],
                "title": "Racer",
                "parent_id": parent["id"],
            },
        )
        if response.status_code != 201:
            failures.append((response.status_code, response.text))

    threads = [threading.Thread(target=_create) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert failures == []

    rows = db.fetch_all(
        "SELECT position FROM pages WHERE parent_id = %s", (parent["id"],)
    )
    assert len(rows) == 4
    assert len({row[0] for row in rows}) == 4, rows
