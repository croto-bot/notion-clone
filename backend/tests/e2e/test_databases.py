"""Databases: default schema and views, rows as pages, property updates."""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from tests.e2e.helpers import assert_error, create_page, create_workspace

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser
    from tests.e2e.stack import Database


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


def test_row_properties_patch_merges_per_key(auth_client: httpx.Client) -> None:
    """Two clients editing different keys of one row must not overwrite each
    other, and a key set to null removes exactly that key."""
    workspace = create_workspace(auth_client)
    database = create_page(auth_client, workspace["id"], kind="database")
    row = create_page(
        auth_client,
        workspace["id"],
        parent_id=database["id"],
        properties={"tags": ["kept"], "status": "todo"},
    )

    # A client that only knows about its own key sends only that key.
    first = auth_client.patch(
        f"/pages/{row['id']}", json={"properties": {"priority": 1}}
    )
    assert first.status_code == 200
    assert first.json()["properties"] == {
        "tags": ["kept"],
        "status": "todo",
        "priority": 1,
    }

    second = auth_client.patch(
        f"/pages/{row['id']}", json={"properties": {"tags": None}}
    )
    assert second.status_code == 200
    assert second.json()["properties"] == {"status": "todo", "priority": 1}

    stored = auth_client.get(f"/pages/{row['id']}").json()
    assert stored["properties"] == {"status": "todo", "priority": 1}


def test_row_properties_patch_merges_atomically_when_writes_overlap(
    auth_client: httpx.Client, db: Database
) -> None:
    """Two PATCHes of different keys, parked on the row lock at the same
    moment, must both land. The merge runs inside one SQL statement; the old
    read-merge-write in Python computed both maps from the same base row, so
    whichever UPDATE committed second erased the other's key."""
    workspace = create_workspace(auth_client)
    database = create_page(auth_client, workspace["id"], kind="database")
    row = create_page(
        auth_client,
        workspace["id"],
        parent_id=database["id"],
        properties={"status": "todo"},
    )

    # Hold the row lock so both PATCHes park inside their UPDATE: each one
    # reads the row (MVCC, unblocked) while the base is still the original,
    # then queues on the lock. Releasing it serializes the two UPDATEs.
    db.execute("BEGIN")
    db.execute("SELECT id FROM pages WHERE id = %s FOR UPDATE", (row["id"],))
    parked_for_s = 1.0
    responses: list[httpx.Response] = []
    durations: list[float] = []

    def send_patch(properties: dict[str, object]) -> None:
        started = time.monotonic()
        responses.append(
            auth_client.patch(f"/pages/{row['id']}", json={"properties": properties})
        )
        durations.append(time.monotonic() - started)

    patches = [{"priority": 1}, {"done": True}]
    threads = [threading.Thread(target=send_patch, args=(patch,)) for patch in patches]
    try:
        for thread in threads:
            thread.start()
        # Give both requests time to reach their blocked UPDATE.
        time.sleep(parked_for_s)
    finally:
        db.execute("ROLLBACK")
        for thread in threads:
            thread.join(timeout=10)

    # Both PATCHes really were parked for the whole window: that is what
    # makes the overlap (two reads of one base row) deterministic.
    assert all(duration >= parked_for_s * 0.5 for duration in durations), durations
    assert all(response.status_code == 200 for response in responses), responses
    stored = auth_client.get(f"/pages/{row['id']}").json()
    assert stored["properties"] == {"status": "todo", "priority": 1, "done": True}


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


#: The cover rule's case list, shared verbatim with the Playwright check in
#: frontend/e2e/pages.spec.ts ("applies one cover rule on both sides of the
#: wire"): the server's validator and the client's isRenderableCover must
#: agree on every row. (value, accepted).
COVER_CASES: list[tuple[str, bool]] = [
    ("gradient-1", True),  # a picker preset key
    ("https://cdn.example.com/bg.png", True),
    ("HTTPS://cdn.example.com/bg.png", True),  # both sides lowercase the scheme
    ("https://cdn.example.com:8443/bg.png", True),  # a port in range
    (
        "https://cdn.example.com/bg image.png",
        True,
    ),  # only the netloc must be whitespace-free
    ("http://cdn.example.com/bg.png", False),  # wrong scheme
    ("javascript:alert(1)", False),
    ("gradient-7", False),  # not a preset key
    ("https://", False),  # no host
    ("https:///x", False),  # empty netloc
    ("https:example.com", False),  # no "//" after the scheme
    ("https://not a url", False),  # whitespace in the netloc
    ("https://cdn.example.com:0/bg.png", False),  # port 0 is not a port
    ("https://cdn.example.com:99999/bg.png", False),  # port out of range
    ("https://cdn.example.com:abc/bg.png", False),  # port not a number
]


def test_cover_must_be_a_preset_or_an_https_url(auth_client: httpx.Client) -> None:
    """The cover lands in a CSS background: only the picker's preset keys and
    the https URLs of COVER_CASES are accepted (422 otherwise), so no other
    scheme or arbitrary string ships into the page background. The same table
    drives the client's picker check in frontend/e2e/pages.spec.ts."""
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    stored: str | None = None
    for value, accepted in COVER_CASES:
        response = auth_client.patch(f"/pages/{page['id']}", json={"cover": value})
        if not accepted:
            body = assert_error(response, 422, "validation_error")
            assert [issue["loc"] for issue in body["detail"]] == [["body", "cover"]]
            continue
        assert response.status_code == 200, (value, response.text)
        assert response.json()["cover"] == value
        stored = value

    # Only the accepted rows ever reached the row, and None clears the cover.
    kept = auth_client.get(f"/pages/{page['id']}").json()
    assert kept["cover"] == stored
    cleared = auth_client.patch(f"/pages/{page['id']}", json={"cover": None}).json()
    assert cleared["cover"] is None


def test_rows_carry_the_callers_role(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """Every row reports the caller's role (read once, not one query per row)."""
    from tests.e2e.helpers import make_member

    workspace = create_workspace(auth_client)
    database = create_page(auth_client, workspace["id"], title="Db", kind="database")
    create_page(auth_client, workspace["id"], parent_id=database["id"], title="Row")
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")

    rows = viewer.client.get(f"/pages/{database['id']}/rows").json()

    assert len(rows) == 1
    assert all(row["role"] == "viewer" for row in rows)
