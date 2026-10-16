"""Recently visited pages (GET /pages/{id} records a visit)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.helpers import create_page, create_workspace

if TYPE_CHECKING:
    import httpx


def test_visits_are_recorded_and_recent_lists_them(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    first = create_page(auth_client, workspace["id"], title="First")
    second = create_page(auth_client, workspace["id"], title="Second")
    create_page(auth_client, workspace["id"], title="Never visited")

    auth_client.get(f"/pages/{first['id']}")
    auth_client.get(f"/pages/{second['id']}")
    auth_client.get(f"/pages/{first['id']}")

    recent = auth_client.get(f"/workspaces/{workspace['id']}/recent").json()

    titles = [page["title"] for page in recent]
    assert titles == ["First", "Second"]  # newest visit first


def test_recent_respects_the_limit(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    pages = [create_page(auth_client, workspace["id"], title=f"P{i}") for i in range(5)]
    for page in pages:
        auth_client.get(f"/pages/{page['id']}")

    recent = auth_client.get(
        f"/workspaces/{workspace['id']}/recent", params={"limit": 2}
    ).json()

    assert [page["title"] for page in recent] == ["P4", "P3"]


def test_recent_excludes_trashed_pages(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Doomed")
    auth_client.get(f"/pages/{page['id']}")
    assert auth_client.get(f"/workspaces/{workspace['id']}/recent").json()

    auth_client.delete(f"/pages/{page['id']}")

    assert auth_client.get(f"/workspaces/{workspace['id']}/recent").json() == []


def test_recent_is_per_workspace(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    other = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Mine")
    create_page(auth_client, other["id"], title="Theirs")
    auth_client.get(f"/pages/{page['id']}")

    recent = auth_client.get(f"/workspaces/{other['id']}/recent").json()
    assert [p["title"] for p in recent] == []
