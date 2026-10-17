# Notion parity reference

Noted copies the look of Notion's web app (notion.so, desktop browser, 2024-2026 UI). This table lists the values the app must match. `frontend/e2e/parity.spec.ts` measures each row marked **Asserted** from computed styles and bounding boxes, in the light and the dark theme, at a 1440 x 1000 viewport. A change that breaks a row fails `make test`.

Values come from Notion's own stylesheet and DOM, as known from inspecting the web app. Rows marked **Not asserted** have no value we trust enough to enforce; the spec checks only their shared tokens (background, shadow, radius, font size).

Tolerance: sizes ±1 px (the slash menu width ±4 px). Colors, font weights and shadows must be exact. The product name stays **Noted**.

## Type

| What | Notion value | Surface | Spec |
|---|---|---|---|
| UI font | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif` | every page | Asserted (start of the stack) |
| Code font | `"SFMono-Regular", Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace` | code block | Asserted (start of the stack) |
| Page title | 40 px, weight 700, line height 1.2 (48 px) | page header, public page | Asserted |
| Body text | 16 px, line height 1.5 (24 px) | editor paragraph | Asserted |
| Heading 1 / 2 / 3 | 1.875 em (30 px) / 1.5 em (24 px) / 1.25 em (20 px), weight 600 | editor | Asserted |
| Quote | 1.2 em (19.2 px) | editor | Asserted |
| Code block text | 85 % (13.6 px) | editor | Asserted |
| Sidebar rows | 14 px, weight 500 | sidebar | Asserted (size) |
| Menu items | 14 px | dropdown menus, popovers | Asserted |
| Database header and cells | 14 px | table view | Asserted |
| Small labels (section titles, hints) | 12 px | menus, sidebar | Not asserted |

## Colors

| Token | Light | Dark | Surface | Spec |
|---|---|---|---|---|
| Text | `rgb(55, 53, 47)` | `rgba(255, 255, 255, 0.81)` | body | Asserted |
| Page background | `#ffffff` | `#191919` | `html`, top bar, comments panel | Asserted |
| Sidebar background | `#f7f7f5` | `#202020` | sidebar | Asserted |
| Hover background | `rgba(55, 53, 47, 0.06)` | `rgba(255, 255, 255, 0.055)` | sidebar rows, menu items, buttons | Asserted (sidebar row) |
| Borders, grid lines | `rgba(55, 53, 47, 0.09)` | `rgba(255, 255, 255, 0.094)` | sidebar edge, table grid, list rows, comments panel | Asserted |
| Menu / popover background | `#ffffff` | `#252525` | menus, popovers, slash menu, toolbar, modals | Asserted |
| Menu shadow | `rgba(15,15,15,0.05) 0 0 0 1px, rgba(15,15,15,0.1) 0 3px 6px, rgba(15,15,15,0.2) 0 9px 24px` | `rgba(15,15,15,0.2) 0 0 0 1px, rgba(15,15,15,0.2) 0 3px 6px, rgba(15,15,15,0.4) 0 9px 24px` | menus, popovers, slash menu, toolbar | Asserted |
| Code block background | `rgb(247, 246, 243)` | `rgba(255, 255, 255, 0.03)` | editor | Asserted |
| Focus ring | `rgba(35, 131, 226, 0.57)` (blue) | same | keyboard focus | Asserted (blue ring present) |
| Inline code text | `#eb5757` | `#eb5757` | editor | Not asserted |

## Metrics

| What | Notion value | Surface | Spec |
|---|---|---|---|
| Sidebar width | 240 px (resizable) | sidebar | Asserted |
| Sidebar row height | 27 px (classic) to 30 px (2024 sidebar) | Home, Search, page tree rows | Asserted (27-30) |
| Top bar height | 45 px | page top bar | Asserted |
| Content width | 708 px (900 px column minus 2 x 96 px) | editor, public page | Asserted |
| Full-width side padding | 96 px | database pages, full-width pages | Asserted |
| Cover height | 30 vh (300 px at 1000 px tall) | page cover | Asserted |
| Page icon | 78 px box, 78 px emoji, overlaps the cover | page header | Asserted |
| Block spacing | 3 px top and bottom padding per block; a one-line paragraph is 30 px | editor | Asserted |
| Space above headings | 2 em / 1.4 em / 1 em of 16 px (32 / 22.4 / 16 px) | editor | Asserted |
| To-do checkbox | 16 px | editor | Asserted |
| List marker gutter | 24 px | editor | Asserted |
| Quote bar | 3 px solid, 14 px text padding | editor | Asserted |
| Menu item height | 28 px | dropdown menus | Asserted |
| Slash menu | 324 px wide; 28 px rows with a 20 px icon, no description line (the description shows in Notion's hover preview) | editor | Asserted |
| Formatting toolbar buttons | 28 px tall | editor | Asserted |
| Quick find (search) | 755 px wide | search modal | Asserted |
| Settings modal | 1150 x 715 px (smaller only when the window is) | settings | Asserted |
| Database header and row | 33 px | table view | Asserted |
| Board column | 260 px | board view | Asserted |
| Gallery card | at least 260 px wide (medium cards) | gallery view | Asserted |
| Workspace name in the sidebar header | one line, ends in an ellipsis before the header buttons | sidebar | Asserted |
| Share popover, page menu, trash popover, comments panel width | no trusted value | top bar, sidebar | Not asserted |

## Radii

| What | Notion value | Spec |
|---|---|---|
| Menus, popovers, slash menu, toolbar | 6 px | Asserted |
| Buttons, rows, inputs | 4 px (3 px on menu rows) | Not asserted |

## Motion and stability

| What | Notion value | Noted contract (docs/SPEC.md §4) | Spec |
|---|---|---|---|
| Hover backgrounds | `background 20ms ease-in` | 100-200 ms ease | Asserted on sidebar rows, menu items, slash items, block handles |
| Menus | fade in, about 150 ms | 150 ms | Not asserted |
| Sidebar collapse | width animates, about 200 ms | 200 ms, width animates over at least 3 frames | Asserted |
| Layout shift on load (CLS) | near 0 | at most 0.02 | Asserted on landing, login, home, page, database, public page |

Noted keeps the slower 100-200 ms hover from its spec on purpose: the contract chose it, and this table records where it differs from Notion.
