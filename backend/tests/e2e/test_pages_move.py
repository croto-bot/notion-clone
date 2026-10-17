"""Moving pages: reparenting, ordering, invalid moves."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from tests.e2e.helpers import (
    assert_error,
    create_page,
    create_workspace,
    held_db_lock,
    make_member,
    wait_for_blocked_queries,
    wait_until_blocked,
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

    The moves serialize on the workspace tree lock, so whoever runs second
    re-reads the committed edge and its subtree check fails. Never a 500,
    never a written cycle.
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


def _assert_acyclic(pages: list[dict[str, Any]]) -> None:
    """Follow parent_id from every page. A repeat is a cycle."""
    parents = {page["id"]: page["parent_id"] for page in pages}
    for start in parents:
        seen: set[str] = set()
        current: str | None = start
        while current is not None:
            assert current not in seen, parents
            seen.add(current)
            current = parents.get(current)


def _moves_parked(queries: list[str]) -> bool:
    """Four row-lock waits, or the workspace lock plus the one writer it let through."""
    row_locks = sum("FOR UPDATE" in query for query in queries)
    advisory = any("pg_advisory_xact_lock" in query for query in queries)
    writing = any(
        "UPDATE pages" in query and "FOR UPDATE" not in query for query in queries
    )
    return row_locks >= 4 or (advisory and writing)


def _one_move_ring(
    auth_client: httpx.Client, make_client: Callable[..., httpx.Client], db: Database
) -> None:
    workspace = create_workspace(auth_client)
    pages = [
        create_page(auth_client, workspace["id"], title=title)
        for title in ("A", "B", "C", "D")
    ]
    moves = {
        pages[0]["id"]: pages[1]["id"],
        pages[1]["id"]: pages[2]["id"],
        pages[2]["id"]: pages[3]["id"],
        pages[3]["id"]: pages[0]["id"],
    }
    token = auth_client.headers["Authorization"].removeprefix("Bearer ")
    responses: list[httpx.Response] = []
    barrier = threading.Barrier(4)

    def _move(client: httpx.Client, page_id: str, parent_id: str) -> None:
        barrier.wait(timeout=10)
        responses.append(
            client.post(f"/pages/{page_id}/move", json={"parent_id": parent_id})
        )

    with held_db_lock(db, "LOCK TABLE pages IN EXCLUSIVE MODE"):
        threads = [
            threading.Thread(
                target=_move, args=(make_client(token), page_id, parent_id)
            )
            for page_id, parent_id in moves.items()
        ]
        for thread in threads:
            thread.start()
        wait_until_blocked(db, _moves_parked)
    for thread in threads:
        thread.join(timeout=30)

    assert len(responses) == 4, responses
    assert all(response.status_code in (200, 400) for response in responses), [
        response.text for response in responses
    ]
    for response in responses:
        if response.status_code == 400:
            assert response.json()["error_code"] == "invalid_move", response.text
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert {page["title"] for page in tree} == {"A", "B", "C", "D"}
    _assert_acyclic(tree)


def test_four_overlapping_moves_cannot_write_a_cycle(
    auth_client: httpx.Client, make_client: Callable[..., httpx.Client], db: Database
) -> None:
    """Four moves that close a ring must not write a cycle.

    A under B locks {A, B}. C under D locks {C, D}. Those sets share no row,
    and the ancestor chain each move locks is the empty snapshot taken before
    it waits. The same is true of B under C and D under A. Row locks let both
    pairs pass the subtree check and commit A -> B -> C -> D -> A. A held
    table lock parks every move after that snapshot and releases them
    together. The tree must end acyclic. Each request is 200 or 400
    invalid_move, never 500.
    """
    # A few releases: one lucky serialization must not hide the race.
    for _round in range(4):
        _one_move_ring(auth_client, make_client, db)


def test_root_move_sees_a_trash_that_commits_while_it_waits(
    auth_client: httpx.Client, make_client: Callable[..., httpx.Client], db: Database
) -> None:
    """A root move parked on the workspace tree lock must re-read deleted_at.

    The move blocks on the same advisory lock the tree writers take. While
    it waits, the row is trashed directly (an API trash would wait on that
    same lock). After the lock is released the move must answer 400
    page_in_trash and leave the parent alone, not 200.
    """
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    page = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Mover"
    )
    token = auth_client.headers["Authorization"].removeprefix("Bearer ")
    box: dict[str, Any] = {}

    def _move(client: httpx.Client) -> None:
        box["response"] = client.post(
            f"/pages/{page['id']}/move", json={"parent_id": None}
        )

    with held_db_lock(
        db,
        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
        (workspace["id"],),
    ):
        thread = threading.Thread(target=_move, args=(make_client(token),))
        thread.start()
        wait_for_blocked_queries(db, count=1, needle="pg_advisory_xact_lock")
        assert db.execute(
            "UPDATE pages SET deleted_at = now() WHERE id = %s",
            (page["id"],),
        )
    thread.join(timeout=30)

    assert_error(box["response"], 400, "page_in_trash")
    now = auth_client.get(f"/pages/{page['id']}").json()
    assert now["deleted_at"] is not None
    assert now["parent_id"] == parent["id"]


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
