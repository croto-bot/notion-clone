"""Sibling order keys (fractional indexing) at their growth edges.

Every insert gets a key strictly between its neighbours, so no sibling is
ever renumbered. These tests drive the key generator through the public API
past the points where a key changes length: many inserts on top, many
appends, and many inserts between the same two siblings.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from tests.e2e.helpers import assert_error, create_page, create_workspace

if TYPE_CHECKING:
    import httpx

    from tests.e2e.stack import Database

# One past the 62 digits of a key's integer part: the next key needs a new head.
PAST_ONE_HEAD = 63


def _children(
    client: httpx.Client, workspace_id: str, parent_id: str | None = None
) -> list[dict[str, Any]]:
    tree = client.get(f"/workspaces/{workspace_id}/page-tree").json()
    return [page for page in tree if page["parent_id"] == parent_id]


def _assert_ordered(pages: list[dict[str, Any]]) -> None:
    positions = [page["position"] for page in pages]
    assert positions == sorted(positions)
    assert len(set(positions)) == len(positions)


def test_many_inserts_on_top_keep_the_order(auth_client: httpx.Client) -> None:
    """Each insert on top goes first, also after the key gains a digit."""
    workspace = create_workspace(auth_client)
    titles = ["Bottom"]
    create_page(auth_client, workspace["id"], title="Bottom")
    for number in range(PAST_ONE_HEAD):
        title = f"Top {number}"
        create_page(auth_client, workspace["id"], title=title, after_id=None)
        titles.insert(0, title)

    pages = _children(auth_client, workspace["id"])

    assert [page["title"] for page in pages] == titles
    _assert_ordered(pages)
    assert len(pages[0]["position"]) == 3  # the integer part grew a digit


def test_insert_after_the_first_key_of_a_shorter_integer(
    auth_client: httpx.Client,
) -> None:
    """Between keys of different lengths (Yzz | Z0, Zz | a0) the order holds."""
    workspace = create_workspace(auth_client)
    create_page(auth_client, workspace["id"], title="Bottom")
    for number in range(PAST_ONE_HEAD):
        create_page(auth_client, workspace["id"], title=f"Top {number}", after_id=None)
    pages = _children(auth_client, workspace["id"])
    first = pages[0]
    last_top = pages[-2]  # the first page created on top, right above Bottom

    after_first = create_page(
        auth_client, workspace["id"], title="After first", after_id=first["id"]
    )
    above_bottom = create_page(
        auth_client, workspace["id"], title="Above bottom", after_id=last_top["id"]
    )

    titles = [page["title"] for page in _children(auth_client, workspace["id"])]
    assert titles[:3] == [first["title"], "After first", pages[1]["title"]]
    assert titles[-3:] == [last_top["title"], "Above bottom", "Bottom"]
    _assert_ordered(_children(auth_client, workspace["id"]))
    assert after_first["position"] > first["position"]
    assert above_bottom["position"] > last_top["position"]


def test_many_appends_keep_the_order(auth_client: httpx.Client) -> None:
    """Each new page goes last, also after the key gains a digit."""
    workspace = create_workspace(auth_client)
    titles = [f"Page {number}" for number in range(PAST_ONE_HEAD)]
    for title in titles:
        create_page(auth_client, workspace["id"], title=title)

    pages = _children(auth_client, workspace["id"])

    assert [page["title"] for page in pages] == titles
    _assert_ordered(pages)
    assert len(pages[-1]["position"]) == 3


def test_insert_on_top_of_a_restored_long_key(auth_client: httpx.Client) -> None:
    """A page restored to the root keeps its long key; an insert on top of it
    gets a shorter key that still sorts first."""
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    for number in range(PAST_ONE_HEAD):
        child = create_page(
            auth_client, workspace["id"], parent_id=parent["id"], title=f"C{number}"
        )
    assert len(child["position"]) == 3
    auth_client.delete(f"/pages/{child['id']}")
    auth_client.delete(f"/pages/{parent['id']}")
    restored = auth_client.post(f"/pages/{child['id']}/restore").json()
    assert (restored["parent_id"], restored["position"]) == (None, child["position"])

    top = create_page(auth_client, workspace["id"], title="Top", after_id=None)

    pages = _children(auth_client, workspace["id"])
    assert [page["title"] for page in pages] == ["Top", child["title"]]
    _assert_ordered(pages)
    assert len(top["position"]) < len(child["position"])


def test_many_inserts_between_the_same_two_siblings(
    auth_client: httpx.Client,
) -> None:
    """Inserting right after one page again and again: the keys grow longer,
    and every new page sits directly under that page."""
    workspace = create_workspace(auth_client)
    anchor = create_page(auth_client, workspace["id"], title="Anchor")
    create_page(auth_client, workspace["id"], title="End")
    titles = ["Anchor", "End"]
    for number in range(16):
        title = f"Wedge {number}"
        create_page(auth_client, workspace["id"], title=title, after_id=anchor["id"])
        titles.insert(1, title)

    pages = _children(auth_client, workspace["id"])

    assert [page["title"] for page in pages] == titles
    _assert_ordered(pages)
    assert max(len(page["position"]) for page in pages) > 3


def test_insert_into_the_gap_of_a_trashed_sibling(auth_client: httpx.Client) -> None:
    """A trashed sibling leaves a gap in the keys; an insert there fills it."""
    workspace = create_workspace(auth_client)
    first = create_page(auth_client, workspace["id"], title="First")
    middle = create_page(auth_client, workspace["id"], title="Middle")
    last = create_page(auth_client, workspace["id"], title="Last")
    auth_client.delete(f"/pages/{middle['id']}")

    in_gap = create_page(
        auth_client, workspace["id"], title="Gap", after_id=first["id"]
    )

    pages = _children(auth_client, workspace["id"])
    assert [page["title"] for page in pages] == ["First", "Gap", "Last"]
    _assert_ordered(pages)
    assert first["position"] < in_gap["position"] < last["position"]


def test_insert_next_to_trashed_wedges(auth_client: httpx.Client) -> None:
    """Inserts after a page and on top still sort right when the pages that
    shaped the keys around them are in the trash."""
    workspace = create_workspace(auth_client)
    anchor = create_page(auth_client, workspace["id"], title="Anchor")
    create_page(auth_client, workspace["id"], title="End")
    for number in range(6):
        wedge = create_page(
            auth_client, workspace["id"], title=f"W{number}", after_id=anchor["id"]
        )
    create_page(auth_client, workspace["id"], title="X", after_id=wedge["id"])
    auth_client.delete(f"/pages/{wedge['id']}")

    create_page(auth_client, workspace["id"], title="Y", after_id=anchor["id"])
    auth_client.delete(f"/pages/{anchor['id']}")
    create_page(auth_client, workspace["id"], title="Top", after_id=None)

    pages = _children(auth_client, workspace["id"])
    assert [page["title"] for page in pages] == [
        "Top",
        "Y",
        "X",
        "W4",
        "W3",
        "W2",
        "W1",
        "W0",
        "End",
    ]
    _assert_ordered(pages)


def test_after_id_that_is_not_a_sibling_goes_last(auth_client: httpx.Client) -> None:
    """SPEC: an after_id outside the target parent falls back to "last"."""
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    create_page(auth_client, workspace["id"], parent_id=parent["id"], title="Child")
    other = create_page(auth_client, workspace["id"], title="Elsewhere")

    response = auth_client.post(
        "/pages",
        json={
            "workspace_id": workspace["id"],
            "parent_id": parent["id"],
            "title": "New",
            "after_id": other["id"],
        },
    )

    assert response.status_code == 201
    children = _children(auth_client, workspace["id"], parent["id"])
    assert [page["title"] for page in children] == ["Child", "New"]


@pytest.mark.parametrize(
    "corrupt_key",
    [
        "a00",  # a trailing zero in the fraction
        "b0",  # head "b" needs two integer digits, the key has one
        "A" + "0" * 26,  # the smallest integer: nothing can go below it
    ],
)
def test_insert_after_a_corrupt_key_is_invalid_move(
    auth_client: httpx.Client, db: Database, corrupt_key: str
) -> None:
    """A stored key the indexer rejects is a 400 invalid_move, never a 500.

    The db fixture writes the key: the API never generates one.
    """
    workspace = create_workspace(auth_client)
    create_page(auth_client, workspace["id"], title="A")
    broken = create_page(auth_client, workspace["id"], title="B")
    assert db.execute(
        "UPDATE pages SET position = %s WHERE id = %s", (corrupt_key, broken["id"])
    )

    response = auth_client.post(
        "/pages",
        json={"workspace_id": workspace["id"], "title": "C", "after_id": broken["id"]},
    )

    assert_error(
        response, 400, "invalid_move", "The sibling order keys leave no valid position"
    )
    assert {page["title"] for page in _children(auth_client, workspace["id"])} == {
        "A",
        "B",
    }
