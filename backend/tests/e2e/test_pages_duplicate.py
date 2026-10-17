"""Duplicating a page with its whole subtree and content."""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

from pycrdt import Doc, XmlElement, XmlFragment, XmlText
from websockets.sync.client import connect

from tests.e2e.helpers import (
    create_page,
    create_workspace,
    doc_with_text,
    yjs_send_update,
    yjs_sync,
    yjs_wait_for,
)

if TYPE_CHECKING:
    import httpx

    from tests.e2e.stack import LiveServer


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
