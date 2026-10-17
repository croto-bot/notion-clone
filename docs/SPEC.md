# Notion clone — product and API spec

This file is the contract between the backend and the frontend. When the code
and this file disagree, fix one of them in the same change.

Stack and rules: see `AGENTS.md` and `.claude/skills/project-standards/SKILL.md`.
They are mandatory (Router -> Service -> Repository, e2e tests only, exact pins).

## 1. Features (scope)

| # | Feature | Notes |
|---|---|---|
| F1 | Auth | Already in the template (register, login, logout, Google OAuth). Restyle the pages to look like Notion. |
| F2 | Workspaces | A user has 1..n workspaces. After sign-in, when the user has none, the frontend creates `"<display name or email name>'s Notion"`. Workspace switcher in the sidebar. Rename, icon (emoji), delete (owner only). |
| F3 | Members and roles | Roles: `owner`, `editor`, `viewer`. Owner adds members by the email of a registered user, changes roles, removes members. A member can leave. Viewers can read only. |
| F4 | Pages tree | Nested pages. Create (root or child), rename, emoji icon, cover, reorder and move with drag and drop in the sidebar, "Move to" dialog, duplicate (with children and content), copy link. |
| F5 | Block editor | BlockNote (ProseMirror) editor with Notion behaviour: `/` slash menu, markdown shortcuts, drag handles (`⋮⋮`), `+` button, formatting toolbar, text and background colors, links, headings 1-3, bullet / numbered / to-do / toggle lists, quote, callout-like blocks, code block, divider, image (by URL), table. Page links: a `Page` slash item creates a child page and inserts a link to it. |
| F6 | Real-time collaboration | Yjs document per page, synced over WebSocket (y-websocket protocol). Live cursors and selections with user name and color. Avatars of the people on the page in the top bar. Offline edits merge on reconnect. |
| F7 | Live workspace | Sidebar, titles, icons and trash update live for every member (workspace events WebSocket). |
| F8 | Trash | Delete moves the page and its subtree to the trash. Trash popover: search, restore, delete forever. A trashed page opens read-only with a red banner "This page is in Trash" + Restore / Delete forever. Undo toast after delete. |
| F9 | Favorites | Per-user favorites section in the sidebar. Star button in the top bar. |
| F10 | Search | Quick find modal (`Cmd/Ctrl+K` and `Cmd/Ctrl+P`, and "Search" in the sidebar). Searches titles and page text. Shows recent pages when the query is empty. Arrow keys + Enter. |
| F11 | Home and recents | `/home`: "Good morning/afternoon/evening, <name>" and "Recently visited" cards. |
| F12 | Page options | `...` menu: full width, small text, font (Default / Serif / Mono), lock page, copy link, duplicate, move to, export Markdown, import Markdown, delete. "Edited <time> ago" by <user>. |
| F13 | Share and publish | Share popover: invite workspace members, "Publish to web" toggle that gives a public link `/share/<public_id>`; the public page is read-only and needs no sign-in. |
| F14 | Comments | Page discussions under the title (like Notion): add comment, reply, edit, delete, resolve / reopen. Comments panel (`Cmd/Ctrl+Shift+U` not required) opened from the top bar. Live update through the workspace events socket. |
| F15 | Databases | A page can be a database (full-page). Rows are pages (`parent_id` = the database page). Property types: `title`, `text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `url`, `person`, `created_time`, `last_edited_time`. Views: `table`, `board` (grouped by a select property, drag cards between columns), `list`, `gallery`. Per view: sort, filter, visible properties. Add / rename / delete / change type of properties. Open a row as a page (with its properties shown above the editor). Inline "+ New" row. |
| F16 | Appearance | Light, dark and system theme (Settings and `Cmd/Ctrl+Shift+L`). Collapsible (`Cmd/Ctrl+\`) and resizable sidebar. |
| F17 | Settings modal | My account (display name), Appearance, Workspace (name, icon, delete), Members (invite, role, remove, leave). |
| F18 | Public landing | `/` is a short Notion-like landing page with "Get Notion free" / "Log in". A signed-in user goes to `/home`. |

Out of scope: billing, email delivery, AI, calendars, page history, file uploads (images are by URL).

## 2. Data model (backend)

All tables: `uuid` PK, `TimestampMixin` (`created_at`, `updated_at`).

- **workspaces**: `name` (str, 1..100), `icon` (str | null, an emoji), `owner_id` (FK users).
- **workspace_members**: `workspace_id` (FK, cascade), `user_id` (FK, cascade), `role` (`StrEnum`: owner/editor/viewer). Unique (`workspace_id`, `user_id`). The creator becomes `owner`.
- **pages**:
  - `workspace_id` (FK, cascade), `parent_id` (FK pages, cascade, null = root)
  - `kind` (`StrEnum`: `page` | `database`)
  - `title` (str, default `""`), `icon` (str | null), `cover` (str | null: a URL or a preset key such as `gradient-1`), `cover_position` (int 0..100, default 50)
  - `position` (str, fractional index for ordering among siblings; the backend computes it)
  - `full_width`, `small_text`, `locked` (bool, default false), `font` (`default` | `serif` | `mono`)
  - `is_public` (bool), `public_id` (str | null, unique, url-safe random, set when published first)
  - `deleted_at` (timestamptz | null; set on the page and its whole subtree), `deleted_root` (bool: true on the page the user deleted)
  - `created_by_id`, `last_edited_by_id` (FK users, set null), `last_edited_at` (timestamptz)
  - `ydoc_state` (bytea | null: the Yjs update that encodes the whole document), `content_text` (text: plain text of the document, for search)
  - `database_schema` (JSONB | null, only on `kind=database`): list of `{id, name, type, options?: [{id, name, color}]}`. The first property is always `{id: "title", name: "Name", type: "title"}`.
  - `database_views` (JSONB | null, only on `kind=database`): list of `{id, name, type, group_by?: property_id, sorts: [{property_id, direction}], filters: [{property_id, op, value}], hidden_properties: [property_id]}`.
  - `properties` (JSONB, default `{}`): values of a database row, keyed by property id (`select` = option id, `multi_select` = list of option ids, `date` = `{start, end?}`, `person` = list of user ids).
- **page_favorites**: `user_id`, `page_id` (cascade), `position`. Unique (`user_id`, `page_id`).
- **page_visits**: `user_id`, `page_id` (cascade), `visited_at`. Unique (`user_id`, `page_id`) (upsert).
- **comments**: `page_id` (cascade), `author_id`, `parent_id` (FK comments, cascade, null = new discussion), `body` (str 1..10000), `resolved` (bool), `edited` (bool).

Access rule: a user sees a workspace and its pages only when a member. A
non-member gets the same `404 not_found` as for a missing row. A viewer gets
`403` with `error_code: "forbidden"` on every write. A locked page refuses
content edits from the collab socket only for viewers (lock is a UI hint for
editors, like Notion).

## 3. REST API

All routes need a session (`Authorization: Bearer <token>`) except `/public/*`.
Errors: JSON `{detail, error_code}`. Lists follow the template (`Page[...]`
with `page`, `size`) unless marked **(not paged)**.

### Workspaces

| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `/workspaces` | | **(not paged)** `WorkspaceResponse[]` of my workspaces, each with `role` (my role) |
| POST | `/workspaces` | `{name, icon?}` | 201 `WorkspaceResponse` |
| GET | `/workspaces/{id}` | | `WorkspaceResponse` |
| PATCH | `/workspaces/{id}` | `{name?, icon?}` (owner) | `WorkspaceResponse` |
| DELETE | `/workspaces/{id}` | (owner) | 204 |
| GET | `/workspaces/{id}/members` | | **(not paged)** `MemberResponse[]` = `{user_id, email, display_name, role, joined_at}` |
| POST | `/workspaces/{id}/members` | `{email, role}` (owner) | 201 `MemberResponse`; unknown email = 404 `user_not_found`; already member = 409 `already_member` |
| PATCH | `/workspaces/{id}/members/{user_id}` | `{role}` (owner) | `MemberResponse`; the last owner cannot lose `owner` (409 `last_owner`) |
| DELETE | `/workspaces/{id}/members/{user_id}` | (owner, or the member self = leave) | 204; the last owner cannot leave (409 `last_owner`) |

`WorkspaceResponse` = `{id, name, icon, owner_id, role, created_at, updated_at}`.

### Pages

`PageSummary` = `{id, workspace_id, parent_id, kind, title, icon, position, is_public, deleted_at, updated_at, last_edited_at, has_children}`.

`PageResponse` = `PageSummary` + `{cover, cover_position, full_width, small_text, locked, font, public_id, created_by, last_edited_by (both {id, display_name, email} | null), created_at, database_schema, database_views, properties, breadcrumbs: [{id, title, icon}] (root first, excluding the page itself), is_favorite, role (my role in the workspace)}`.

| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `/workspaces/{id}/page-tree` | | **(not paged)** `PageSummary[]` of all non-trashed pages of the workspace except database rows (`parent.kind = database`), sorted by `position` |
| GET | `/workspaces/{id}/trash` | `q?` | **(not paged)** `PageSummary[]` of trashed pages with `deleted_root = true`, newest first |
| GET | `/workspaces/{id}/recent` | `limit?` (default 12) | **(not paged)** `PageSummary[]` I visited, newest visit first (not trashed) |
| GET | `/workspaces/{id}/search` | `q`, `limit?` (default 20) | **(not paged)** `SearchResult[]` = `PageSummary` + `{snippet, breadcrumbs}`. Match on title and `content_text`, case-insensitive; title matches first |
| GET | `/workspaces/{id}/favorites` | | **(not paged)** `PageSummary[]` of my favorites, by position |
| POST | `/pages` | `{workspace_id, parent_id?, kind?, title?, icon?, after_id?, properties?}` | 201 `PageResponse`. Without `after_id` the page goes last. `kind=database` gets the default schema (Name, Tags multi_select, Status select with Not started/In progress/Done) and one `Table` view |
| GET | `/pages/{id}` | | `PageResponse`. Also records a visit (upsert `page_visits`) |
| PATCH | `/pages/{id}` | any of `{title, icon, cover, cover_position, full_width, small_text, locked, font, is_public, database_schema, database_views, properties}` | `PageResponse`; sets `last_edited_*`; `is_public: true` creates `public_id` once. `properties` is a partial map merged per key (a key set to `null` removes that key; `properties: null` clears all), so two clients editing different keys of one row both survive; clients should send only the key they changed |
| POST | `/pages/{id}/move` | `{parent_id: uuid | null, after_id?: uuid | null}` | `PageResponse`. `after_id = null` = first. A page cannot move into itself or its own subtree (400 `invalid_move`) |
| POST | `/pages/{id}/duplicate` | | 201 `PageResponse` of the copy (same title, like Notion), placed right after the source, with the whole subtree and Yjs content |
| DELETE | `/pages/{id}` | | 204. Moves the page and its subtree to the trash |
| POST | `/pages/{id}/restore` | | `PageResponse`. Restores the subtree; when the parent is still in the trash or gone, the page goes to the root |
| DELETE | `/pages/{id}/permanent` | | 204. Only trashed pages (else 409 `not_in_trash`) |
| GET | `/pages/{id}/rows` | | **(not paged)** `PageResponse[]` (without breadcrumbs: `[]`) of a database's non-trashed rows, by position. 400 `not_a_database` for normal pages |
| GET | `/pages/{id}/document` | | `{state: base64 | null}`: the stored Yjs update (the live collab room's state when a socket is connected, else `ydoc_state`) |
| PUT | `/pages/{id}/document` | `{state: base64}` | `{state}`. Merges the update into the stored document (used by Markdown import before the editor connects, and by tests). Viewer = 403, trashed page = 400 `page_in_trash` |
| PUT | `/pages/{id}/favorite` | | 204 |
| DELETE | `/pages/{id}/favorite` | | 204 |
| GET | `/pages/{id}/comments` | | **(not paged)** `CommentResponse[]` oldest first = `{id, page_id, parent_id, body, resolved, edited, author: {id, display_name, email}, created_at, updated_at}` |
| POST | `/pages/{id}/comments` | `{body, parent_id?}` | 201 `CommentResponse` (viewers may comment) |
| PATCH | `/comments/{id}` | `{body?, resolved?}` | author edits body; any editor+ resolves |
| DELETE | `/comments/{id}` | | 204 (author or owner) |

### Public

| Method | Path | Result |
|---|---|---|
| GET | `/public/pages/{public_id}` | `PublicPageResponse` = `{id, title, icon, cover, cover_position, full_width, small_text, font, kind, state (base64 Yjs | null), database_schema, database_views, rows (for databases: `[{id, title, icon, properties, created_at, last_edited_at}]`), children: [{id, title, icon, public_id}] (public children only)}`. 404 when not published or trashed |

### Error codes the backend adds to this section's tables

These codes are part of the contract (the tables above name them where they apply):

| Case | Status | `error_code` |
|---|---|---|
| Viewer write, or a non-owner doing an owner-only change | 403 | `forbidden` |
| Adding a member whose email is not a registered user | 404 | `user_not_found` |
| Adding a user who is already a member | 409 | `already_member` |
| The last owner leaving or losing the `owner` role | 409 | `last_owner` |
| Moving a page into itself, its own subtree, a trashed page, or a page of another workspace | 400 | `invalid_move` |
| Any write on a trashed page: `PATCH /pages/{id}`, move, duplicate, comment create, favorite, `PUT .../document` | 400 | `page_in_trash` |
| Restore or permanent-delete of a page that is not in the trash | 409 | `not_in_trash` |
| `GET /pages/{id}/rows` on a page that is not a database | 400 | `not_a_database` |

Placement clarifications: without `after_id` a new or moved page goes **last**; an explicit `"after_id": null` puts it **first** (create and move behave the same). A create whose `parent_id` is missing, in another workspace, or in the trash gets a 404.

### WebSockets

Auth: `?token=<session token>` in the query string (browsers cannot set headers on WebSocket). A bad token closes with code `4401`; no access closes with `4404`. Membership is checked when the socket connects (removing a member later does not cut an open socket; it fails on the next connect).

| Path | Protocol |
|---|---|
| `WS /pages/{id}/collab?token=` | y-websocket sync + awareness protocol (room = page id). Server: `pycrdt` + `pycrdt-websocket`. The server loads `ydoc_state`, applies updates, stores the full state again (debounced about 1 s and on the last editor's disconnect), extracts plain text to `content_text`, and sets `last_edited_*` to the user who most recently sent a document update. Viewers and trashed pages are read-only: the server drops their state-pushing messages (sync step 2 and updates; sync step 1 still answers, so they receive the document, and awareness flows both ways). Rooms live for the process lifetime; a page without a connected socket reads and writes `ydoc_state` directly. |
| `WS /workspaces/{id}/events?token=` | Server -> client JSON events, one per change in the workspace: `{type, page_id?, actor_id}` with `type` in `page.created`, `page.updated`, `page.moved`, `page.deleted`, `page.restored`, `page.purged`, `comment.changed`, `members.changed`, `workspace.updated`. In-process pub/sub (one backend process). The client invalidates the matching queries. |

The frontend document: BlockNote's Yjs binding uses the `XmlFragment` named `document-store`. Text extraction on the server reads that fragment.

## 4. Frontend

### Routes

| Path | File | What |
|---|---|---|
| `/` | `routes/index.tsx` | landing (signed-in users -> `/home`) |
| `/login`, `/register` | existing | Notion-styled |
| `/home` | `routes/_authed/home.tsx` | greeting + recently visited |
| `/p/$pageId` | `routes/_authed/p/$pageId.tsx` | page or database |
| `/share/$publicId` | `routes/share/$publicId.tsx` | public read-only page, no sign-in |

The `items` example feature (backend module, migration rows stay in history,
frontend page, tests) is removed: this is a product, not a template.

### Layout (Notion look and feel)

- Font: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif`. Text `rgb(55,53,47)` light / `rgba(255,255,255,0.81)` dark. Page bg `#fff` / `#191919`. Sidebar bg `#f7f7f5` / `#202020`. Hover bg `rgba(55,53,47,0.06)` / `rgba(255,255,255,0.055)`. Borders `rgba(55,53,47,0.09)`. Radius 4-6 px. Small text 14 px in the UI; menus with shadow `rgba(15,15,15,0.05) 0 0 0 1px, rgba(15,15,15,0.1) 0 3px 6px, rgba(15,15,15,0.2) 0 9px 24px`.
- **Sidebar** (240 px, resizable 200-480, collapsible): workspace switcher (icon + name + chevron, menu with the workspaces, "New workspace", "Log out"); Search; Home; Settings; Favorites; "Private"/"Workspace" section title "Pages" with a `+`; page tree rows (28 px high, toggle arrow, icon or page glyph, title or "Untitled", hover `...` and `+`); "New page"; Trash at the bottom. Drag and drop to reorder and nest.
- **Top bar** (45 px): breadcrumbs (icon + title, truncated), "Edited …", collaborator avatars, Share, comments, star, `...`.
- **Page**: optional cover (full width, 30 vh, "Change cover" / "Reposition" / "Remove" on hover), icon (78 px emoji, overlaps the cover), hover row "Add icon · Add cover · Add comment", title (40 px, 700, placeholder "Untitled"), discussions, then the editor. Content width 708 px (full width: 96 px side padding). Enter in the title moves focus into the editor.
- **Emoji picker**: search + grid + "Random" + "Remove" (use `frimousse`).
- **Cover picker**: preset gradients and colors (no external images), plus "Link" (URL).
- Every popover / menu / modal closes on Escape and outside click and has keyboard focus.
- Animations: 100-200 ms ease for hovers, menus and the sidebar.

## 5. Testing

- Backend: `backend/tests/e2e/test_<feature>.py` for every route, the roles, the trash rules, the move rules, search, public pages, both WebSockets (use the `websockets` client lib or `httpx-ws`, real server, real Yjs updates built with `pycrdt` in the test).
- Frontend: `frontend/e2e/<feature>.spec.ts` for every feature F1-F18, including a two-browser-context collaboration test (both users type in one page and see each other's text and cursor names), the live sidebar, drag and drop in the sidebar and on the board, dark mode, keyboard shortcuts and the public page.
- E2E ports: each agent uses its own `E2E_DB_PORT`, `E2E_BACKEND_PORT`, `E2E_FRONTEND_PORT` (port 55432 is taken on this machine).
