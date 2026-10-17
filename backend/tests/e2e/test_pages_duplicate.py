"""Duplicating a page with its whole subtree and content."""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

from pycrdt import Doc, XmlFragment

from tests.e2e.helpers import create_page, create_workspace, doc_with_text

if TYPE_CHECKING:
    import httpx

    from tests.e2e.stack import Database


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
