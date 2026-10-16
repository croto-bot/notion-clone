"""Comments: discussions, replies, resolve, permissions."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.e2e.helpers import (
    assert_error,
    create_page,
    create_workspace,
    make_member,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx

    from tests.e2e.helpers import RegisteredUser


def test_comment_and_reply_listed_oldest_first(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    first = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "First comment"}
    ).json()
    auth_client.post(
        f"/pages/{page['id']}/comments",
        json={"body": "A reply", "parent_id": first["id"]},
    )

    listed = auth_client.get(f"/pages/{page['id']}/comments").json()

    assert [c["body"] for c in listed] == ["First comment", "A reply"]
    assert listed[1]["parent_id"] == first["id"]
    author = listed[0]["author"]
    assert author["email"] == auth_client.get("/users/me").json()["email"]


def test_comment_shape(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    comment = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Shape check"}
    ).json()

    assert comment["resolved"] is False
    assert comment["edited"] is False
    assert comment["page_id"] == page["id"]
    assert set(comment["author"]) == {"id", "display_name", "email"}


def test_author_edits_the_body(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    comment = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Typo citzen"}
    ).json()

    updated = auth_client.patch(
        f"/comments/{comment['id']}", json={"body": "Typo citizen"}
    ).json()

    assert updated["body"] == "Typo citizen"
    assert updated["edited"] is True


def test_editing_someone_elses_body_is_forbidden(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    comment = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Mine"}
    ).json()
    editor = make_member(register_user, auth_client, workspace["id"])

    response = editor.client.patch(
        f"/comments/{comment['id']}", json={"body": "Not yours"}
    )

    assert_error(response, 403, "forbidden")


def test_editors_resolve_and_reopen(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    comment = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Needs a decision"}
    ).json()
    editor = make_member(register_user, auth_client, workspace["id"])

    resolved = editor.client.patch(
        f"/comments/{comment['id']}", json={"resolved": True}
    ).json()
    assert resolved["resolved"] is True

    reopened = auth_client.patch(
        f"/comments/{comment['id']}", json={"resolved": False}
    ).json()
    assert reopened["resolved"] is False


def test_viewers_comment_but_cannot_resolve(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    viewer = make_member(register_user, auth_client, workspace["id"], role="viewer")

    comment = viewer.client.post(
        f"/pages/{page['id']}/comments", json={"body": "Viewer voice"}
    )
    assert comment.status_code == 201

    response = viewer.client.patch(
        f"/comments/{comment.json()['id']}", json={"resolved": True}
    )
    assert_error(response, 403, "forbidden")


def test_delete_by_author_and_by_owner(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    editor = make_member(register_user, auth_client, workspace["id"])
    by_editor = editor.client.post(
        f"/pages/{page['id']}/comments", json={"body": "Editor note"}
    ).json()
    another_by_editor = editor.client.post(
        f"/pages/{page['id']}/comments", json={"body": "Another editor note"}
    ).json()
    by_owner = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Owner note"}
    ).json()

    # Only the author or the workspace owner can delete: an editor cannot
    # delete someone else's comment...
    assert_error(editor.client.delete(f"/comments/{by_owner['id']}"), 403, "forbidden")
    # ...the author deletes their own...
    assert (
        editor.client.delete(f"/comments/{another_by_editor['id']}").status_code == 204
    )
    # ...and the owner deletes someone else's.
    assert auth_client.delete(f"/comments/{by_editor['id']}").status_code == 204
    assert auth_client.delete(f"/comments/{by_owner['id']}").status_code == 204
    assert auth_client.get(f"/pages/{page['id']}/comments").json() == []


def test_comments_of_a_trashed_page_cannot_be_created(
    auth_client: httpx.Client,
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    auth_client.delete(f"/pages/{page['id']}")

    response = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Too late"}
    )

    assert_error(response, 400, "page_in_trash")


def test_non_member_sees_no_comments(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    stranger = register_user().client

    assert_error(stranger.get(f"/pages/{page['id']}/comments"), 404, "not_found")


def test_body_limits(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])

    empty = auth_client.post(f"/pages/{page['id']}/comments", json={"body": ""})
    assert empty.status_code == 422
    huge = auth_client.post(f"/pages/{page['id']}/comments", json={"body": "x" * 10001})
    assert huge.status_code == 422
