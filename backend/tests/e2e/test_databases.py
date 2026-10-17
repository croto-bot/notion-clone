"""Databases: default schema and views, rows as pages, property updates."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.helpers import assert_error, create_page, create_workspace

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser


def test_new_database_gets_the_default_schema_and_a_table_view(
    auth_client: httpx.Client,
) -> None:
    workspace = create_workspace(auth_client)

    database = create_page(auth_client, workspace["id"], kind="database")

    assert database["kind"] == "database"
    schema = database["database_schema"]
    assert schema[0] == {"id": "title", "name": "Name", "type": "title"}
    names = [prop["name"] for prop in schema]
    assert names == ["Name", "Tags", "Status"]
    status = next(prop for prop in schema if prop["name"] == "Status")
    assert [option["name"] for option in status["options"]] == [
        "Not started",
        "In progress",
        "Done",
    ]
    views = database["database_views"]
    assert len(views) == 1
    assert views[0]["type"] == "table"
    assert views[0]["name"] == "Table"


def test_rows_are_pages_under_the_database(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    database = create_page(auth_client, workspace["id"], kind="database")

    row = create_page(
        auth_client,
        workspace["id"],
        parent_id=database["id"],
        title="A task",
        properties={"title": "A task"},
    )

    assert row["parent_id"] == database["id"]
    assert row["properties"] == {"title": "A task"}


def test_rows_are_listed_by_position_without_breadcrumbs(
    auth_client: httpx.Client,
) -> None:
    workspace = create_workspace(auth_client)
    database = create_page(auth_client, workspace["id"], kind="database")
    create_page(auth_client, workspace["id"], parent_id=database["id"], title="B")
    create_page(auth_client, workspace["id"], parent_id=database["id"], title="A")

    rows = auth_client.get(f"/pages/{database['id']}/rows").json()

    assert [row["title"] for row in rows] == ["B", "A"]
    assert all(row["breadcrumbs"] == [] for row in rows)


def test_rows_of_a_normal_page_is_not_a_database(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    response = auth_client.get(f"/pages/{page['id']}/rows")

    assert_error(response, 400, "not_a_database")


def test_schema_and_views_can_be_updated(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    database = create_page(auth_client, workspace["id"], kind="database")
    new_schema = [
        {"id": "title", "name": "Name", "type": "title"},
        {"id": "p1", "name": "Effort", "type": "number"},
    ]
    new_views = [
        {
            "id": "v1",
            "name": "Board",
            "type": "board",
            "group_by": "p1",
            "sorts": [],
            "filters": [],
            "hidden_properties": [],
        }
    ]

    updated = auth_client.patch(
        f"/pages/{database['id']}",
        json={"database_schema": new_schema, "database_views": new_views},
    ).json()

    assert updated["database_schema"] == new_schema
    assert updated["database_views"] == new_views
    again = auth_client.get(f"/pages/{database['id']}").json()
    assert again["database_schema"] == new_schema


def test_row_properties_can_be_updated(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    database = create_page(auth_client, workspace["id"], kind="database")
    row = create_page(auth_client, workspace["id"], parent_id=database["id"])

    updated = auth_client.patch(
        f"/pages/{row['id']}",
        json={"properties": {"title": "Renamed row", "tags": ["a", "b"]}},
    ).json()

    assert updated["properties"] == {"title": "Renamed row", "tags": ["a", "b"]}


def test_page_options_can_be_updated(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    updated = auth_client.patch(
        f"/pages/{page['id']}",
        json={
            "title": "Renamed",
            "icon": "🚀",
            "cover": "gradient-2",
            "cover_position": 20,
            "full_width": True,
            "small_text": True,
            "locked": True,
            "font": "mono",
        },
    ).json()

    assert updated["title"] == "Renamed"
    assert updated["icon"] == "🚀"
    assert updated["cover"] == "gradient-2"
    assert updated["cover_position"] == 20
    assert updated["full_width"] is True
    assert updated["small_text"] is True
    assert updated["locked"] is True
    assert updated["font"] == "mono"
    assert updated["last_edited_by"]["id"] == updated["created_by"]["id"]


def test_rows_carry_the_callers_role(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """Every row reports the caller's role (read once, not one query per row)."""
    from tests.e2e.helpers import make_member

    workspace = create_workspace(auth_client)
    database = create_page(
        auth_client, workspace["id"], title="Db", kind="database"
    )
    create_page(
        auth_client, workspace["id"], parent_id=database["id"], title="Row"
    )
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")

    rows = viewer.client.get(f"/pages/{database['id']}/rows").json()

    assert len(rows) == 1
    assert all(row["role"] == "viewer" for row in rows)
