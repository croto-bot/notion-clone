"""Search: titles and page text, title matches first."""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

from tests.e2e.helpers import create_page, create_workspace, doc_with_text

if TYPE_CHECKING:
    import httpx


def _put_text(client: httpx.Client, page_id: str, *texts: str) -> None:
    _doc, update = doc_with_text(*texts)
    response = client.put(
        f"/pages/{page_id}/document",
        json={"state": base64.b64encode(update).decode()},
    )
    assert response.status_code == 200, response.text


def test_search_matches_titles_case_insensitively(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    create_page(auth_client, workspace["id"], title="Quarterly Report")
    create_page(auth_client, workspace["id"], title="Grocery list")

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "quarterly"}
    ).json()

    assert [r["title"] for r in results] == ["Quarterly Report"]
    assert results[0]["snippet"]


def test_search_matches_page_text(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Boring title")
    _put_text(auth_client, page["id"], "The exotic pangolin eats ants")

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "pangolin"}
    ).json()

    assert [r["id"] for r in results] == [page["id"]]
    assert "pangolin" in results[0]["snippet"].lower()


def test_title_matches_come_first(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    text_only = create_page(auth_client, workspace["id"], title="Plain")
    in_title = create_page(auth_client, workspace["id"], title="Zebra crossing")
    _put_text(auth_client, text_only["id"], "Zebra facts and more zebra notes")

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "zebra"}
    ).json()

    assert [r["id"] for r in results] == [in_title["id"], text_only["id"]]


def test_search_respects_the_limit(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    for i in range(5):
        create_page(auth_client, workspace["id"], title=f"Report {i}")

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search",
        params={"q": "report", "limit": 2},
    ).json()

    assert len(results) == 2


def test_search_returns_breadcrumbs(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Parent")
    create_page(auth_client, workspace["id"], parent_id=parent["id"], title="Child")

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "child"}
    ).json()

    assert [b["title"] for b in results[0]["breadcrumbs"]] == ["Parent"]


def test_search_excludes_trashed_pages(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Trash me")
    auth_client.delete(f"/pages/{page['id']}")

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "trash me"}
    ).json()

    assert results == []


def test_search_children_and_breadcrumbs_from_one_workspace_pass(
    auth_client: httpx.Client,
) -> None:
    """Search builds breadcrumbs and has_children from one workspace read.

    Review finding 10: each hit used to walk its parents one query at a time
    and count children with another (up to a hundred queries per keystroke).
    The results must stay the same, and has_children must not count a child
    that sits in the trash (the sidebar has no expander for it).
    """
    workspace = create_workspace(auth_client)
    root = create_page(auth_client, workspace["id"], title="Root")
    middle = create_page(auth_client, workspace["id"], parent_id=root["id"], title="Mid")
    leaf = create_page(
        auth_client, workspace["id"], parent_id=middle["id"], title="Leaf Zephyr"
    )
    trashed_child = create_page(
        auth_client, workspace["id"], parent_id=leaf["id"], title="Parked"
    )
    assert auth_client.delete(f"/pages/{trashed_child['id']}").status_code == 204

    results = auth_client.get(
        f"/workspaces/{workspace['id']}/search", params={"q": "zephyr"}
    ).json()

    assert [hit["id"] for hit in results] == [leaf["id"]]
    assert [b["title"] for b in results[0]["breadcrumbs"]] == ["Root", "Mid"]
    assert results[0]["has_children"] is False
