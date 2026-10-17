"""Comments: discussions, replies, resolve, permissions."""

from __future__ import annotations

import uuid
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


def test_reply_parent_must_belong_to_the_same_page(
    auth_client: httpx.Client,
) -> None:
    """A reply's parent_id must be a comment of the very same page.

    Review finding 12: the parent comment was never checked, so a member who
    knew a comment id from another workspace could graft a reply onto it
    (and deleting the foreign comment cascade-deleted the reply).
    """
    home = create_workspace(auth_client)
    home_page = create_page(auth_client, home["id"])
    foreign = create_workspace(auth_client)
    foreign_page = create_page(auth_client, foreign["id"])
    foreign_comment = auth_client.post(
        f"/pages/{foreign_page['id']}/comments", json={"body": "Elsewhere"}
    ).json()

    response = auth_client.post(
        f"/pages/{home_page['id']}/comments",
        json={"body": "A reply", "parent_id": foreign_comment["id"]},
    )

    assert_error(response, 404, "not_found")
    listed = auth_client.get(f"/pages/{home_page['id']}/comments").json()
    assert [comment["body"] for comment in listed] == []


def test_comment_on_a_missing_page_is_404(auth_client: httpx.Client) -> None:
    missing = str(uuid.uuid4())

    response = auth_client.post(f"/pages/{missing}/comments", json={"body": "Hello"})

    assert_error(response, 404, "not_found", f"Page {missing} not found")
    assert_error(auth_client.get(f"/pages/{missing}/comments"), 404, "not_found")


def test_edit_or_delete_a_missing_comment_is_404(auth_client: httpx.Client) -> None:
    missing = str(uuid.uuid4())

    edited = auth_client.patch(f"/comments/{missing}", json={"body": "New"})
    deleted = auth_client.delete(f"/comments/{missing}")

    assert_error(edited, 404, "not_found", f"Comment {missing} not found")
    assert_error(deleted, 404, "not_found", f"Comment {missing} not found")


def test_non_member_cannot_touch_a_comment(
    auth_client: httpx.Client, register_user: Callable[..., RegisteredUser]
) -> None:
    """A comment of a workspace the user is not in is a 404, like a missing one."""
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    comment = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Private"}
    ).json()
    stranger = register_user().client

    edited = stranger.patch(f"/comments/{comment['id']}", json={"resolved": True})
    deleted = stranger.delete(f"/comments/{comment['id']}")

    assert_error(edited, 404, "not_found", f"Comment {comment['id']} not found")
    assert_error(deleted, 404, "not_found", f"Comment {comment['id']} not found")
    listed = auth_client.get(f"/pages/{page['id']}/comments").json()
    assert [(c["body"], c["resolved"]) for c in listed] == [("Private", False)]


def test_empty_patch_changes_nothing(auth_client: httpx.Client) -> None:
    workspace = create_workspace(auth_client)
    page = create_page(auth_client, workspace["id"])
    comment = auth_client.post(
        f"/pages/{page['id']}/comments", json={"body": "Unchanged"}
    ).json()

    response = auth_client.patch(f"/comments/{comment['id']}", json={})

    assert response.status_code == 200
    assert (response.json()["body"], response.json()["edited"]) == ("Unchanged", False)
    listed = auth_client.get(f"/pages/{page['id']}/comments").json()
    assert [(c["body"], c["edited"], c["resolved"]) for c in listed] == [
        ("Unchanged", False, False)
    ]
