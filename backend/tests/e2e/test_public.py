"""Public pages: publish, read anonymously, unpublish, trash."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.helpers import assert_error, create_page, create_workspace

if TYPE_CHECKING:
    import httpx


def test_publishing_creates_a_stable_public_id(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Share me")

    published = auth_client.patch(
        f"/pages/{page['id']}", json={"is_public": True}
    ).json()
    assert published["is_public"] is True
    assert published["public_id"]

    again = auth_client.patch(f"/pages/{page['id']}", json={"is_public": True}).json()
    assert again["public_id"] == published["public_id"]


def test_public_page_needs_no_session(
    api: httpx.Client, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Public page", icon="🌍")
    auth_client.patch(
        f"/pages/{page['id']}", json={"is_public": True, "full_width": True}
    )
    public_id = auth_client.get(f"/pages/{page['id']}").json()["public_id"]

    response = api.get(f"/public/pages/{public_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Public page"
    assert body["icon"] == "🌍"
    assert body["full_width"] is True
    assert body["children"] == []


def test_public_children_are_listed(
    api: httpx.Client, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    parent = create_page(auth_client, workspace["id"], title="Public parent")
    public_child = create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Public child"
    )
    create_page(
        auth_client, workspace["id"], parent_id=parent["id"], title="Private child"
    )
    auth_client.patch(f"/pages/{parent['id']}", json={"is_public": True})
    auth_client.patch(f"/pages/{public_child['id']}", json={"is_public": True})
    public_id = auth_client.get(f"/pages/{parent['id']}").json()["public_id"]

    body = api.get(f"/public/pages/{public_id}").json()

    assert [child["title"] for child in body["children"]] == ["Public child"]
    assert all(child["public_id"] for child in body["children"])


def test_unpublished_or_unknown_pages_are_404(
    api: httpx.Client, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Private")

    assert_error(api.get("/public/pages/no-such-id"), 404, "not_found")
    assert_error(api.get("/public/pages/whatever"), 404, "not_found")
    detail = auth_client.get(f"/pages/{page['id']}").json()
    assert detail["public_id"] is None


def test_trashing_hides_the_public_page(
    api: httpx.Client, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"], title="Once public")
    auth_client.patch(f"/pages/{page['id']}", json={"is_public": True})
    public_id = auth_client.get(f"/pages/{page['id']}").json()["public_id"]
    assert api.get(f"/public/pages/{public_id}").status_code == 200

    auth_client.delete(f"/pages/{page['id']}")

    assert_error(api.get(f"/public/pages/{public_id}"), 404, "not_found")


def test_public_database_lists_rows(
    api: httpx.Client, auth_client: httpx.Client
) -> None:
    workspace = create_workspace(auth_client)
    database = create_page(
        auth_client, workspace["id"], kind="database", title="Public DB"
    )
    create_page(
        auth_client,
        workspace["id"],
        parent_id=database["id"],
        title="Row one",
        properties={"title": "Row one"},
    )
    auth_client.patch(f"/pages/{database['id']}", json={"is_public": True})
    public_id = auth_client.get(f"/pages/{database['id']}").json()["public_id"]

    body = api.get(f"/public/pages/{public_id}").json()

    assert body["kind"] == "database"
    assert [row["title"] for row in body["rows"]] == ["Row one"]
    assert body["database_schema"][0]["type"] == "title"
