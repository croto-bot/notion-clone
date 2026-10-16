"""Yjs document helpers: build, merge and extract text from page documents.

A page document is a Yjs update (``pages.ydoc_state``). BlockNote's Yjs
binding stores the editor content in the ``XmlFragment`` named
``document-store`` (the frontend contract, docs/SPEC.md §WebSockets); the
plain text extracted from that fragment feeds ``pages.content_text`` for
search.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pycrdt import Doc, XmlFragment, XmlText

if TYPE_CHECKING:
    from pycrdt import XmlElement

DOCUMENT_STORE = "document-store"


def merge_updates(*updates: bytes) -> bytes:
    """Return the state that contains every update (Yjs merge)."""
    doc = Doc()
    for update in updates:
        if update:
            doc.apply_update(update)
    return doc.get_update()


def extract_text(state: bytes | None) -> str:
    """Return the plain text of the ``document-store`` fragment.

    Block elements become lines, in document order; nested text (list items,
    quotes) is walked recursively. A state without the fragment (an empty
    document, or one written by another client) yields "".
    """
    if not state:
        return ""
    doc = Doc()
    doc.apply_update(state)
    fragment = doc.get(DOCUMENT_STORE, type=XmlFragment)
    parts: list[str] = []

    def walk(node: XmlFragment | XmlElement | XmlText) -> None:
        if isinstance(node, XmlText):
            if text := str(node):
                parts.append(text)
            return
        for child in node.children:
            walk(child)

    walk(fragment)
    return "\n".join(parts)
