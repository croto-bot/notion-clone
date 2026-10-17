"""Moving pages: reparenting, ordering, invalid moves."""

from __future__ import annotations

import threading
import uuid
from typing import TYPE_CHECKING, Any

from tests.e2e.helpers import (
    assert_error,
    create_page,
    create_workspace,
    held_db_lock,
    make_member,
    wait_for_blocked_queries,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
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
    assert db.execute(
        "UPDATE pages SET parent_id = %s WHERE id = %s", (b["id"], a["id"])
    )

    assert_error(
        auth_client.post(f"/pages/{b['id']}/move", json={"parent_id": a["id"]}),
        400,
        "invalid_move",
    )

    # The parent-chain walk of a move under the cycled tree must stop too.
    moved = auth_client.post(f"/pages/{c['id']}/move", json={"parent_id": b["id"]})
    assert moved.status_code == 200
    assert moved.json()["parent_id"] == b["id"]


# --- cross-workspace moves (review finding 6) -----------------------------------


def test_move_under_another_workspaces_parent_is_invalid(
    auth_client: httpx.Client,
) -> None:
    """A move under a page of another workspace is 400 invalid_move (SPEC).

    The mover is a member of both workspaces, so the parent is visible: the
    client must see invalid_move, not the 404 a missing page returns.
    """
    workspace = create_workspace(auth_client)
    other_workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Mover")
    foreign_parent = create_page(auth_client, other_workspace["id"], title="Foreign")

    response = auth_client.post(
        f"/pages/{page['id']}/move", json={"parent_id": foreign_parent["id"]}
    )

    assert_error(response, 400, "invalid_move")
    assert auth_client.get(f"/pages/{page['id']}").json()["parent_id"] is None


def test_move_under_an_invisible_parent_is_404(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """A parent of a workspace the mover cannot see stays a plain 404."""
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Mover")
    stranger = register_user()
    stranger_workspace = create_workspace(stranger.client)
    hidden_parent = create_page(stranger.client, stranger_workspace["id"])

    response = auth_client.post(
        f"/pages/{page['id']}/move", json={"parent_id": hidden_parent["id"]}
    )

    assert_error(response, 404, "not_found")


def test_create_under_another_workspaces_parent_is_404(
    auth_client: httpx.Client,
) -> None:
    """Create keeps its 404: the SPEC's create contract is unchanged."""
    workspace = create_workspace(auth_client)
    other_workspace = create_workspace(auth_client)
    foreign_parent = create_page(auth_client, other_workspace["id"])

    response = auth_client.post(
        "/pages",
        json={"workspace_id": workspace["id"], "parent_id": foreign_parent["id"]},
    )

    assert_error(response, 404, "not_found")


# --- overlapping moves and stale reads under the row locks ----------------------


def test_overlapping_cycle_moves_one_succeeds_one_is_invalid(
    auth_client: httpx.Client, make_client: Callable[..., httpx.Client]
) -> None:
    """Two moves that would form a cycle: one wins, one gets invalid_move.

    The moves lock the same two rows (each page is the other's target
    parent), so they serialize: whoever locks second re-reads the committed
    edges and its subtree check fails. Never a 500, never a written cycle.
    """
    workspace = create_workspace(auth_client)
    a = create_page(auth_client, workspace["id"], title="A")
    b = create_page(auth_client, workspace["id"], title="B")
    token = auth_client.headers["Authorization"].removeprefix("Bearer ")
    moves = {a["id"]: b["id"], b["id"]: a["id"]}  # page -> new parent
    responses: list[httpx.Response] = []
    barrier = threading.Barrier(2)

    def _move(client: httpx.Client, page_id: str) -> None:
        barrier.wait(timeout=10)
        responses.append(
            client.post(f"/pages/{page_id}/move", json={"parent_id": moves[page_id]})
        )

    threads = [
        threading.Thread(target=_move, args=(make_client(token), page_id))
        for page_id in moves
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(response.status_code for response in responses) == [200, 400], [
        response.text for response in responses
    ]
    rejected = next(r for r in responses if r.status_code == 400)
    assert rejected.json()["error_code"] == "invalid_move"

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert {page["title"] for page in tree} == {"A", "B"}  # no cycle: both live
    moved = next(r for r in responses if r.status_code == 200).json()
    now = auth_client.get(f"/pages/{moved['id']}").json()
    assert now["parent_id"] == moved["parent_id"]  # the winner's edge stuck


def test_move_rejects_a_page_trashed_while_it_waited_for_the_lock(
    auth_client: httpx.Client, make_client: Callable[..., httpx.Client], db: Database
) -> None:
    """A trash that commits while a move waits for its locks is seen.

    The move's access check reads the page before it blocks on the row
    locks: a delete committed in that window is only visible when the lock
    query loads fresh rows. A held row lock parks the move after its read;
    the page is then trashed through the API and the lock released - the
    move must come back 400 page_in_trash, not succeed on the stale row.
    """
    workspace = create_workspace(auth_client)
    x1 = create_page(auth_client, workspace["id"], title="X1")
    x2 = create_page(auth_client, workspace["id"], parent_id=x1["id"], title="X2")
    target = create_page(
        auth_client, workspace["id"], parent_id=x2["id"], title="Target"
    )
    held = [x1["id"], x2["id"], target["id"]]
    # The mover must sort after every locked row, so the move blocks before
    # it ever locks (and shields) the moved page.
    mover = create_page(auth_client, workspace["id"], title="Mover")
    attempts = 1
    while uuid.UUID(mover["id"]) < max(uuid.UUID(page_id) for page_id in held):
        mover = create_page(auth_client, workspace["id"], title="Mover")
        attempts += 1
        assert attempts <= 80, "no page id sorted after the locked rows"

    box: dict[str, Any] = {}

    def _move(client: httpx.Client) -> None:
        box["response"] = client.post(
            f"/pages/{mover['id']}/move", json={"parent_id": target["id"]}
        )

    token = auth_client.headers["Authorization"].removeprefix("Bearer ")
    with held_db_lock(
        db, "SELECT id FROM pages WHERE id = ANY(%s) FOR UPDATE", ([*held],)
    ):
        thread = threading.Thread(target=_move, args=(make_client(token),))
        thread.start()
        wait_for_blocked_queries(db, count=1, needle="FOR UPDATE")
        assert auth_client.delete(f"/pages/{mover['id']}").status_code == 204
    thread.join(timeout=30)

    assert_error(box["response"], 400, "page_in_trash")
    now = auth_client.get(f"/pages/{mover['id']}").json()
    assert now["deleted_at"] is not None
    assert now["parent_id"] is None  # the move never landed


def test_viewer_cannot_move_pages(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """Review finding 13: the viewer-write paths need their own tests."""
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")
    page = create_page(auth_client, workspace["id"], title="Stays")

    response = viewer.client.post(f"/pages/{page['id']}/move", json={"parent_id": None})

    assert_error(response, 403, "forbidden")
    assert auth_client.get(f"/pages/{page['id']}").json()["parent_id"] is None
