"""The page document endpoint: GET and PUT of the stored Yjs update."""

from __future__ import annotations

import base64
import threading
from typing import TYPE_CHECKING

from pycrdt import Doc, XmlFragment

from tests.e2e.helpers import (
    assert_error,
    create_page,
    create_workspace,
    doc_with_text,
    held_db_lock,
    wait_for_blocked_queries,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import Database


def test_document_starts_empty(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    response = auth_client.get(f"/pages/{page['id']}/document").json()

    assert response == {"state": None}


def test_put_then_get_round_trips(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    _doc, update = doc_with_text("Round trip", "Second block")

    put = auth_client.put(
        f"/pages/{page['id']}/document",
        json={"state": base64.b64encode(update).decode()},
    )
    assert put.status_code == 200

    stored = auth_client.get(f"/pages/{page['id']}/document").json()
    doc = Doc()
    doc.apply_update(base64.b64decode(stored["state"]))
    fragment = doc.get("document-store", type=XmlFragment)
    text = str(fragment)
    assert "Round trip" in text
    assert "Second block" in text


def test_put_merges_updates(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    first_doc, first_update = doc_with_text("First author text")
    second_doc, _second_update = doc_with_text("Second author text")
    second_update = second_doc.get_update()

    auth_client.put(
        f"/pages/{page['id']}/document",
        json={"state": base64.b64encode(first_update).decode()},
    )
    merged = auth_client.put(
        f"/pages/{page['id']}/document",
        json={"state": base64.b64encode(second_update).decode()},
    )

    doc = Doc()
    doc.apply_update(base64.b64decode(merged.json()["state"]))
    text = str(doc.get("document-store", type=XmlFragment))
    assert "First author text" in text
    assert "Second author text" in text


def test_put_document_text_is_searchable(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Searchable")
    _doc, update = doc_with_text("unique-zephyr-content")

    auth_client.put(
        f"/pages/{page['id']}/document",
        json={"state": base64.b64encode(update).decode()},
    )

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "zephyr"}
    ).json()
    assert [r["id"] for r in results] == [page["id"]]


def test_viewer_cannot_put_the_document(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    from tests.e2e.helpers import make_member

    workspace = create_workspace(auth_client)
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")
    page = create_page(auth_client, workspace["id"])
    _doc, update = doc_with_text("Nope")

    response = viewer.client.put(
        f"/pages/{page['id']}/document",
        json={"state": base64.b64encode(update).decode()},
    )

    assert_error(response, 403, "forbidden")


def test_invalid_base64_is_422(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    response = auth_client.put(
        f"/pages/{page['id']}/document", json={"state": "not base64!!"}
    )

    assert_error(response, 422, "validation_error")


def test_put_document_after_the_page_was_purged_is_404(
    auth_client: httpx.Client, db: Database
) -> None:
    """A PUT whose page is purged mid-request answers 404, not a silent 200.

    The interleaving is forced: a held row lock parks the PUT's UPDATE after
    the request has already read the page. The lock holder then deletes the
    row (the purge's end state) and commits, so the UPDATE matches no row.
    The PUT must answer not_found and must not resurrect the page.
    """
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    _doc, update = doc_with_text("Written too late")
    box: dict[str, httpx.Response] = {}

    def _put() -> None:
        box["response"] = auth_client.put(
            f"/pages/{page['id']}/document",
            json={"state": base64.b64encode(update).decode()},
        )

    with held_db_lock(
        db, "SELECT id FROM pages WHERE id = %s FOR UPDATE", (page["id"],)
    ) as lock_conn:
        thread = threading.Thread(target=_put)
        thread.start()
        wait_for_blocked_queries(db, count=1, needle="UPDATE pages")
        assert lock_conn.execute("DELETE FROM pages WHERE id = %s", (page["id"],))
    thread.join(timeout=10)

    assert_error(box["response"], 404, "not_found")
    assert (
        db.fetch_one("SELECT count(*) FROM pages WHERE id = %s", (page["id"],))[0] == 0
    )
