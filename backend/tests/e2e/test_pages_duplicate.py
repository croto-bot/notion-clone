"""Duplicating a page with its whole subtree and content."""

from __future__ import annotations

import base64
import threading
from typing import TYPE_CHECKING

from pycrdt import Doc, XmlElement, XmlFragment, XmlText
from websockets.sync.client import connect

from tests.e2e.helpers import (
    assert_error,
    create_page,
    create_workspace,
    doc_with_text,
    held_db_lock,
    make_member,
    wait_for_blocked_queries,
    yjs_send_update,
    yjs_sync,
    yjs_wait_for,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import Database, LiveServer


def test_duplicate_copies_the_page_after_the_source(
    auth_client: httpx.Client,
) -> None:
    workspace = create_workspace(auth_client)
    source = create_page(auth_client, workspace["id"], title="Original", icon="📄")
    later = create_page(auth_client, workspace["id"], title="Later")

    response = auth_client.post(f"/pages/{source['id']}/duplicate")

    assert response.status_code == 201
    copy = response.json()
    assert copy["title"] == "Original"
    assert copy["id"] != source["id"]
    assert copy["parent_id"] == source["parent_id"]
    assert copy["icon"] == "📄"

    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    titles = [page["title"] for page in tree]
    assert titles == ["Original", "Original", "Later"]
    del later


def test_duplicate_copies_children_and_settings(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    source = create_page(auth_client, workspace["id"], title="Parent", icon="🎨")
    create_page(
        auth_client, workspace["id"], parent_id=source["id"], title="Kid", icon="🧒"
    )
    auth_client.patch(
        f"/pages/{source['id']}",
        json={"cover": "gradient-1", "full_width": True, "font": "serif"},
    )

    copy = auth_client.post(f"/pages/{source['id']}/duplicate").json()

    copy_detail = auth_client.get(f"/pages/{copy['id']}").json()
    assert copy_detail["cover"] == "gradient-1"
    assert copy_detail["full_width"] is True
    assert copy_detail["font"] == "serif"
    assert copy_detail["has_children"] is True
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    kid_copy = [p for p in tree if p["title"] == "Kid"]
    assert len(kid_copy) == 2  # the original child and the copy's child


def test_concurrent_duplicates_of_one_page_all_land(
    auth_client: httpx.Client,
    make_client: Callable[..., httpx.Client],
    db: Database,
) -> None:
    """Two duplicates started together both land, with distinct positions.

    The interleaving is forced: the workspace tree lock is held from here,
    both duplicates start, and pg_stat_activity proves both are parked on
    that lock before it is released. Serialized behind it, the second
    duplicate reads the first copy's committed position and writes its own
    key. If duplicate_page stops taking the workspace lock, nothing parks
    the requests and this test fails its wait. Both requests are 201, never
    500, and the three rows do not share a position key. Each thread uses
    its own client: one connection pool shared across threads is not safe.
    """
    workspace = create_workspace(auth_client)
    source = create_page(auth_client, workspace["id"], title="Original")
    token = auth_client.headers["Authorization"].removeprefix("Bearer ")
    responses: list[httpx.Response] = []

    def _duplicate(client: httpx.Client) -> None:
        responses.append(client.post(f"/pages/{source['id']}/duplicate"))

    with held_db_lock(
        db,
        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
        (workspace["id"],),
    ):
        threads = [
            threading.Thread(target=_duplicate, args=(make_client(token),))
            for _ in range(2)
        ]
        for thread in threads:
            thread.start()
        wait_for_blocked_queries(db, count=2, needle="pg_advisory_xact_lock")
    for thread in threads:
        thread.join(timeout=30)

    assert [response.status_code for response in responses] == [201, 201], [
        response.text for response in responses
    ]
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    positions = [page["position"] for page in tree]
    assert len(positions) == 3  # the source and both copies
    assert len(set(positions)) == 3, positions


def test_duplicate_and_search_return_in_a_cycled_tree(
    auth_client: httpx.Client, db: Database
) -> None:
    """A parent cycle must not hang duplicate, search or the breadcrumbs.

    Two overlapping moves could write A -> B -> A before the row locks
    existed; the db fixture inserts that cycle directly. Every walk over a
    cycled tree must stop (a visited set) and return: duplicate copies, the
    search's breadcrumb walk and the page detail's breadcrumbs all come
    back, instead of spinning forever or filling 100 garbage entries.
    """
    workspace = create_workspace(auth_client)
    a = create_page(auth_client, workspace["id"], title="Cycle A")
    b = create_page(auth_client, workspace["id"], parent_id=a["id"], title="Cycle B")
    # B is under A; force A under B: the tree is now the cycle A -> B -> A.
    assert db.execute(
        "UPDATE pages SET parent_id = %s WHERE id = %s", (b["id"], a["id"])
    )

    duplicated = auth_client.post(f"/pages/{a['id']}/duplicate")
    assert duplicated.status_code == 201, duplicated.text

    searched = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "Cycle"}
    )
    assert searched.status_code == 200, searched.text
    assert len(searched.json()) >= 2
    for result in searched.json():
        ids = [crumb["id"] for crumb in result["breadcrumbs"]]
        assert len(ids) == len(set(ids))  # every parent appears once: no loop
        assert len(ids) <= 4  # the walk stops at the four live pages

    detail = auth_client.get(f"/pages/{b['id']}")
    assert detail.status_code == 200, detail.text
    crumb_ids = [crumb["id"] for crumb in detail.json()["breadcrumbs"]]
    assert len(crumb_ids) == len(set(crumb_ids))
    assert len(crumb_ids) <= 4


def test_duplicate_copies_the_yjs_document(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    source = create_page(auth_client, workspace["id"], title="With content")
    _doc, update = doc_with_text("Duplicated body text")
    state = base64.b64encode(update).decode()
    auth_client.put(f"/pages/{source['id']}/document", json={"state": state})

    copy = auth_client.post(f"/pages/{source['id']}/duplicate").json()

    stored = auth_client.get(f"/pages/{copy['id']}/document").json()
    assert stored["state"]
    doc = Doc()
    doc.apply_update(base64.b64decode(stored["state"]))
    fragment = doc.get("document-store", type=XmlFragment)
    assert "Duplicated body text" in str(fragment)


def test_duplicate_copies_the_live_room_state_while_it_is_dirty(
    server: LiveServer, auth_client: httpx.Client
) -> None:
    """A duplicate right after an edit, inside the collab room's ~1 s flush
    debounce, must carry the live text into the copy: both its document and
    the content_text that search reads."""
    workspace = create_workspace(auth_client)
    source = create_page(auth_client, workspace["id"], title="Dirty")
    token = auth_client.headers["Authorization"].removeprefix("Bearer ")
    socket_url = (
        f"{server.base_url.replace('http://', 'ws://')}"
        f"/pages/{source['id']}/collab?token={token}"
    )

    with connect(socket_url, open_timeout=5) as conn:
        doc, _ = doc_with_text()
        yjs_sync(conn, doc)
        fragment = doc.get("document-store", type=XmlFragment)
        with doc.transaction():
            fragment.children.append(
                XmlElement("p", contents=[XmlText("flushless-needle")])
            )
        yjs_send_update(conn, doc)
        yjs_wait_for(conn, doc, "flushless-needle")

        # Duplicate right after the edit, before the room's ~1 s flush debounce
        # could persist it: the copy must still carry the live text.
        copy = auth_client.post(f"/pages/{source['id']}/duplicate").json()

        stored_copy = auth_client.get(f"/pages/{copy['id']}/document").json()
        copy_doc = Doc()
        copy_doc.apply_update(base64.b64decode(stored_copy["state"]))
        assert "flushless-needle" in str(
            copy_doc.get("document-store", type=XmlFragment)
        )

        results = auth_client.get(
            f"/workspaces/{workspace['id']}/search", params={"q": "flushless-needle"}
        ).json()
        assert copy["id"] in [result["id"] for result in results]


def test_duplicate_of_a_trashed_page_is_rejected(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    auth_client.delete(f"/pages/{page['id']}")

    response = auth_client.post(f"/pages/{page['id']}/duplicate")

    assert response.status_code == 400
    assert response.json()["error_code"] == "page_in_trash"


def test_duplicate_skips_trashed_children(
    auth_client: httpx.Client, db: Database
) -> None:
    """A trashed child (and its subtree) must not come back in the copy.

    Review finding 4: the copy used to include trashed descendants as live
    pages, resurrecting deleted content with its Yjs document.
    """
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    child = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Child"
    )
    grandchild = create_page(
        auth_client, workspace["id"], parent_id=child["id"], title="Grandchild"
    )
    assert auth_client.delete(f"/pages/{child['id']}").status_code == 204

    response = auth_client.post(f"/pages/{parent['id']}/duplicate")

    assert response.status_code == 201
    assert response.json()["has_children"] is False
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert [page["title"] for page in tree] == ["Parent", "Parent"]
    assert auth_client.get(f"/pages/{child['id']}").json()["deleted_at"] is not None
    assert (
        auth_client.get(f"/pages/{grandchild['id']}").json()["deleted_at"] is not None
    )
    # parent, trashed child + grandchild, and the copy: nothing else
    assert db.fetch_one("SELECT count(*) FROM pages")[0] == 4
    assert db.fetch_one("SELECT count(*) FROM pages WHERE deleted_at IS NULL")[0] == 2


def test_viewer_cannot_duplicate_pages(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """Review finding 13: the viewer-write paths need their own tests."""
    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")
    page = create_page(auth_client, workspace["id"], title="Only once")

    response = viewer.client.post(f"/pages/{page['id']}/duplicate")

    assert_error(response, 403, "forbidden")
    tree = auth_client.get(f"/workspaces/{workspace['id']}/page-tree").json()
    assert [p["title"] for p in tree] == ["Only once"]
