"""Moving pages: reparenting, ordering, invalid moves."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.helpers import assert_error, create_page, create_workspace

if TYPE_CHECKING:
    import httpx

    from tests.e2e.stack import Database


def test_move_to_another_parent(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    a = create_page(auth_client, workspace["id"], title="A")
    b = create_page(auth_client, workspace["id"], title="B")
    child = create_page(auth_client, workspace["id"], parent_id=a["id"], title="Child")

    response = auth_client.post(
        f"/pages/{child['id']}/move", json={"parent_id": b["id"]}
    )

    assert response.status_code == 200
    assert response.json()["parent_id"] == b["id"]
    assert [
        c["title"]
        for c in auth_client.get(f"/pages/{child['id']}").json()["breadcrumbs"]
    ] == ["B"]


def test_move_to_root_first_and_last(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    a = create_page(auth_client, workspace["id"], title="A")
    child = create_page(auth_client, workspace["id"], parent_id=a["id"], title="Child")
    create_page(auth_client, workspace["id"], title="Root sibling")

    first = auth_client.post(
        f"/pages/{child['id']}/move", json={"parent_id": None, "after_id": None}
    )
    assert first.json()["parent_id"] is None

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert tree[0]["title"] == "Child"

    last = auth_client.post(f"/pages/{child['id']}/move", json={"parent_id": None})
    assert last.status_code == 200
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert tree[-1]["title"] == "Child"


def test_move_between_siblings_with_after_id(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    a = create_page(auth_client, workspace["id"], title="A")
    create_page(auth_client, workspace["id"], title="B")
    c = create_page(auth_client, workspace["id"], title="C")

    moved = auth_client.post(
        f"/pages/{c['id']}/move", json={"parent_id": None, "after_id": a["id"]}
    )

    assert moved.status_code == 200
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert [page["title"] for page in tree] == ["A", "C", "B"]


def test_move_into_itself_is_invalid(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    response = auth_client.post(
        f"/pages/{page['id']}/move", json={"parent_id": page["id"]}
    )

    assert_error(response, 400, "invalid_move")


def test_move_into_own_subtree_is_invalid(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    root = create_page(auth_client, workspace["id"])
    child = create_page(auth_client, workspace["id"], parent_id=root["id"])
    grandchild = create_page(auth_client, workspace["id"], parent_id=child["id"])

    response = auth_client.post(
        f"/pages/{root['id']}/move", json={"parent_id": grandchild["id"]}
    )

    assert_error(response, 400, "invalid_move")


def test_move_missing_page_is_404(auth_client: httpx.Client) -> None:
    response = auth_client.post(
        "/pages/00000000-0000-4000-8000-000000000000/move",
        json={"parent_id": None},
    )

    assert_error(response, 404, "not_found")


# --- parent cycles (review finding 5) -------------------------------------------


def test_move_in_a_cycled_tree_is_invalid_not_a_hang(
    auth_client: httpx.Client, db: Database
) -> None:
    """A parent cycle (two overlapping moves) must not hang the tree walks.

    The API cannot create the cycle without the fix, so the db fixture inserts
    it: A -> B -> A. Every recursive query must stop (CYCLE clause) and the
    cycle-forming move must return 400 invalid_move, not a 500 or a hang.
    """
    workspace = create_workspace(auth_client)
    a = create_page(auth_client, workspace["id"], title="A")
    b = create_page(auth_client, workspace["id"], parent_id=a["id"], title="B")
    c = create_page(auth_client, workspace["id"], title="C")
    # B is under A; force A under B: the tree is now the cycle A -> B -> A.
    assert db.execute("UPDATE pages SET parent_id = %s WHERE id = %s", (b["id"], a["id"]))

    assert_error(
        auth_client.post(f"/pages/{b['id']}/move", json={"parent_id": a["id"]}),
        400,
        "invalid_move",
    )

    # The parent-chain walk of a move under the cycled tree must stop too.
    moved = auth_client.post(f"/pages/{c['id']}/move", json={"parent_id": b["id"]})
    assert moved.status_code == 200
    assert moved.json()["parent_id"] == b["id"]
