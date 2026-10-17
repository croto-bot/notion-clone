/**
 * Shared fixtures and helpers for every e2e spec.
 *
 *   import { test, expect } from './fixtures'
 *
 * Everything here drives the real stack that playwright.config.ts starts:
 * Postgres in Docker, the FastAPI backend (real migrations) and the frontend
 * dev server. Seed data through the backend's public HTTP API (helpers below).
 * Never mock: ESLint rejects page.route() & co. and mock libraries in e2e/.
 *
 * Adding a feature:
 *   1. Write e2e/<feature>.spec.ts that imports from './fixtures'.
 *   2. Put API helpers for the new resource here, next to createPage().
 *   3. Visit every new page from a spec, and use every new endpoint in
 *      src/lib/api-endpoints.ts from a spec or a helper here. e2e/guards.spec.ts
 *      fails for a route or an endpoint that no test uses.
 *   4. Never skip a test, and never stub the network: ESLint fails on both.
 *
 * Running: `bun run test:e2e` starts the whole stack and stops it after. To keep
 * a stack you started yourself, set E2E_REUSE=1 (see playwright.config.ts).
 *
 * Fixtures:
 *   api         APIRequestContext with baseURL = the real backend (no auth header).
 *   user        A new user registered through POST /auth/register, with its session token.
 *   authedPage  A page in its own browser context, already signed in as `user`.
 *   loginAs     (user) => a new signed-in page for any other user.
 */
import { randomUUID } from 'node:crypto'
import {
  test as base,
  expect,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import { AUTH_TOKEN_KEY } from '../src/lib/auth'
import type { AuthSessionResponse } from '../src/types/auth'
import type { Comment, CreateCommentData, UpdateCommentData } from '../src/types/comment'
import type {
  CreatePageData,
  DocumentResponse,
  MovePageData,
  PageResponse,
  PageSummary,
  SearchResult,
  UpdatePageData,
} from '../src/types/page'
import type { PublicPage } from '../src/types/public-page'
import type { CurrentUser, UpdateCurrentUserData } from '../src/types/user'
import type {
  CreateWorkspaceData,
  Member,
  Role,
  UpdateWorkspaceData,
  Workspace,
} from '../src/types/workspace'
import { BACKEND_URL, FRONTEND_URL } from './support/stack'

export { expect }
export type { Locator, Page, Request } from '@playwright/test'
export { BACKEND_URL, FRONTEND_URL }

export interface TestUser {
  email: string
  password: string
  /** The name given at sign-up; empty when none. */
  displayName: string
  /** Real session id from the backend. The app sends it as `Authorization: Bearer <token>`. */
  token: string
}

/** What the API helpers need to act as a user: its session token. */
export type Token = Pick<TestUser, 'token'>

/** Meets the register form rules (8+ characters). */
export const PASSWORD = 'Correct-Horse-42'

/** A new address for every call, so tests never share users. Uses a real TLD: the backend rejects reserved ones. */
export function uniqueEmail(label = 'user'): string {
  return `e2e-${label}-${randomUUID()}@example.com`
}

async function expectOk(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(`${what} failed: HTTP ${response.status()} ${await response.text()}`)
  }
}

export function authHeaders(user: Pick<TestUser, 'token'>): Record<string, string> {
  return { Authorization: `Bearer ${user.token}` }
}

// ---------------------------------------------------------------------------
// Real backend API helpers (seeding and checking state). Add new resources here.
// ---------------------------------------------------------------------------

export async function registerUser(
  api: APIRequestContext,
  email = uniqueEmail(),
  password = PASSWORD,
  displayName = ''
): Promise<TestUser> {
  const response = await api.post('/auth/register', {
    data: { email, raw_password: password, display_name: displayName },
  })
  await expectOk(response, `POST /auth/register (${email})`)
  const session = (await response.json()) as AuthSessionResponse
  return { email, password, displayName, token: session.id }
}

/** Signs in through POST /auth/login and returns the new session token. */
export async function loginUser(
  api: APIRequestContext,
  email: string,
  password: string
): Promise<string> {
  const response = await api.post('/auth/login', { data: { email, password } })
  await expectOk(response, `POST /auth/login (${email})`)
  return ((await response.json()) as AuthSessionResponse).id
}

/** `GET /users/me` */
export async function getMe(api: APIRequestContext, user: Token): Promise<CurrentUser> {
  const response = await api.get('/users/me', { headers: authHeaders(user) })
  await expectOk(response, 'GET /users/me')
  return (await response.json()) as CurrentUser
}

export async function updateMe(
  api: APIRequestContext,
  user: Token,
  data: UpdateCurrentUserData
): Promise<CurrentUser> {
  const response = await api.patch('/users/me', { data, headers: authHeaders(user) })
  await expectOk(response, 'PATCH /users/me')
  return (await response.json()) as CurrentUser
}

export async function listWorkspaces(api: APIRequestContext, user: Token): Promise<Workspace[]> {
  const response = await api.get('/workspaces', { headers: authHeaders(user) })
  await expectOk(response, 'GET /workspaces')
  return (await response.json()) as Workspace[]
}

export async function createWorkspace(
  api: APIRequestContext,
  owner: Token,
  data: CreateWorkspaceData = { name: `Workspace ${randomUUID().slice(0, 8)}` }
): Promise<Workspace> {
  const response = await api.post('/workspaces', { data, headers: authHeaders(owner) })
  await expectOk(response, 'POST /workspaces')
  return (await response.json()) as Workspace
}

export async function updateWorkspace(
  api: APIRequestContext,
  owner: Token,
  workspaceId: string,
  data: UpdateWorkspaceData
): Promise<Workspace> {
  const response = await api.patch(`/workspaces/${workspaceId}`, {
    data,
    headers: authHeaders(owner),
  })
  await expectOk(response, `PATCH /workspaces/${workspaceId}`)
  return (await response.json()) as Workspace
}

export async function deleteWorkspace(
  api: APIRequestContext,
  owner: Token,
  workspaceId: string
): Promise<void> {
  const response = await api.delete(`/workspaces/${workspaceId}`, { headers: authHeaders(owner) })
  await expectOk(response, `DELETE /workspaces/${workspaceId}`)
}

export async function listMembers(
  api: APIRequestContext,
  user: Token,
  workspaceId: string
): Promise<Member[]> {
  const response = await api.get(`/workspaces/${workspaceId}/members`, {
    headers: authHeaders(user),
  })
  await expectOk(response, `GET /workspaces/${workspaceId}/members`)
  return (await response.json()) as Member[]
}

export async function addMember(
  api: APIRequestContext,
  owner: Token,
  workspaceId: string,
  member: Pick<TestUser, 'email'>,
  role: Role = 'editor'
): Promise<Member> {
  const response = await api.post(`/workspaces/${workspaceId}/members`, {
    data: { email: member.email, role },
    headers: authHeaders(owner),
  })
  await expectOk(response, `POST /workspaces/${workspaceId}/members`)
  return (await response.json()) as Member
}

export async function setMemberRole(
  api: APIRequestContext,
  owner: Token,
  workspaceId: string,
  userId: string,
  role: Role
): Promise<Member> {
  const response = await api.patch(`/workspaces/${workspaceId}/members/${userId}`, {
    data: { role },
    headers: authHeaders(owner),
  })
  await expectOk(response, `PATCH /workspaces/${workspaceId}/members/${userId}`)
  return (await response.json()) as Member
}

export async function removeMember(
  api: APIRequestContext,
  actor: Token,
  workspaceId: string,
  userId: string
): Promise<void> {
  const response = await api.delete(`/workspaces/${workspaceId}/members/${userId}`, {
    headers: authHeaders(actor),
  })
  await expectOk(response, `DELETE /workspaces/${workspaceId}/members/${userId}`)
}

/** The user's first workspace, created when the user has none (what the app does after sign-in). */
export async function ensureWorkspace(api: APIRequestContext, user: TestUser): Promise<Workspace> {
  const existing = await listWorkspaces(api, user)
  return existing[0] ?? createWorkspace(api, user, { name: `${user.email.split('@')[0]}'s Notion` })
}

export async function createPage(
  api: APIRequestContext,
  owner: Token,
  data: CreatePageData
): Promise<PageResponse> {
  const response = await api.post('/pages', { data, headers: authHeaders(owner) })
  await expectOk(response, 'POST /pages')
  return (await response.json()) as PageResponse
}

export async function getPage(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<PageResponse> {
  const response = await api.get(`/pages/${pageId}`, { headers: authHeaders(user) })
  await expectOk(response, `GET /pages/${pageId}`)
  return (await response.json()) as PageResponse
}

export async function updatePage(
  api: APIRequestContext,
  user: Token,
  pageId: string,
  data: UpdatePageData
): Promise<PageResponse> {
  const response = await api.patch(`/pages/${pageId}`, { data, headers: authHeaders(user) })
  await expectOk(response, `PATCH /pages/${pageId}`)
  return (await response.json()) as PageResponse
}

export async function movePage(
  api: APIRequestContext,
  user: Token,
  pageId: string,
  data: MovePageData
): Promise<PageResponse> {
  const response = await api.post(`/pages/${pageId}/move`, { data, headers: authHeaders(user) })
  await expectOk(response, `POST /pages/${pageId}/move`)
  return (await response.json()) as PageResponse
}

export async function duplicatePage(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<PageResponse> {
  const response = await api.post(`/pages/${pageId}/duplicate`, { headers: authHeaders(user) })
  await expectOk(response, `POST /pages/${pageId}/duplicate`)
  return (await response.json()) as PageResponse
}

export async function trashPage(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<void> {
  const response = await api.delete(`/pages/${pageId}`, { headers: authHeaders(user) })
  await expectOk(response, `DELETE /pages/${pageId}`)
}

export async function restorePage(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<PageResponse> {
  const response = await api.post(`/pages/${pageId}/restore`, { headers: authHeaders(user) })
  await expectOk(response, `POST /pages/${pageId}/restore`)
  return (await response.json()) as PageResponse
}

export async function purgePage(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<void> {
  const response = await api.delete(`/pages/${pageId}/permanent`, { headers: authHeaders(user) })
  await expectOk(response, `DELETE /pages/${pageId}/permanent`)
}

export async function favoritePage(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<void> {
  const response = await api.put(`/pages/${pageId}/favorite`, { headers: authHeaders(user) })
  await expectOk(response, `PUT /pages/${pageId}/favorite`)
}

export async function unfavoritePage(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<void> {
  const response = await api.delete(`/pages/${pageId}/favorite`, { headers: authHeaders(user) })
  await expectOk(response, `DELETE /pages/${pageId}/favorite`)
}

/** Every page of the workspace except trashed ones and database rows. */
export async function pageTree(
  api: APIRequestContext,
  user: Token,
  workspaceId: string
): Promise<PageSummary[]> {
  const response = await api.get(`/workspaces/${workspaceId}/page-tree`, {
    headers: authHeaders(user),
  })
  await expectOk(response, `GET /workspaces/${workspaceId}/page-tree`)
  return (await response.json()) as PageSummary[]
}

export async function listTrash(
  api: APIRequestContext,
  user: Token,
  workspaceId: string
): Promise<PageSummary[]> {
  const response = await api.get(`/workspaces/${workspaceId}/trash`, {
    headers: authHeaders(user),
  })
  await expectOk(response, `GET /workspaces/${workspaceId}/trash`)
  return (await response.json()) as PageSummary[]
}

export async function listFavorites(
  api: APIRequestContext,
  user: Token,
  workspaceId: string
): Promise<PageSummary[]> {
  const response = await api.get(`/workspaces/${workspaceId}/favorites`, {
    headers: authHeaders(user),
  })
  await expectOk(response, `GET /workspaces/${workspaceId}/favorites`)
  return (await response.json()) as PageSummary[]
}

export async function recentPages(
  api: APIRequestContext,
  user: Token,
  workspaceId: string
): Promise<PageSummary[]> {
  const response = await api.get(`/workspaces/${workspaceId}/recent?limit=12`, {
    headers: authHeaders(user),
  })
  await expectOk(response, `GET /workspaces/${workspaceId}/recent`)
  return (await response.json()) as PageSummary[]
}

export async function searchPages(
  api: APIRequestContext,
  user: Token,
  workspaceId: string,
  q: string
): Promise<SearchResult[]> {
  const response = await api.get(
    `/workspaces/${workspaceId}/search?${new URLSearchParams({ q, limit: '20' })}`,
    { headers: authHeaders(user) }
  )
  await expectOk(response, `GET /workspaces/${workspaceId}/search`)
  return (await response.json()) as SearchResult[]
}

export async function listRows(
  api: APIRequestContext,
  user: Token,
  databaseId: string
): Promise<PageResponse[]> {
  const response = await api.get(`/pages/${databaseId}/rows`, { headers: authHeaders(user) })
  await expectOk(response, `GET /pages/${databaseId}/rows`)
  return (await response.json()) as PageResponse[]
}

export async function getDocument(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<DocumentResponse> {
  const response = await api.get(`/pages/${pageId}/document`, { headers: authHeaders(user) })
  await expectOk(response, `GET /pages/${pageId}/document`)
  return (await response.json()) as DocumentResponse
}

export async function listComments(
  api: APIRequestContext,
  user: Token,
  pageId: string
): Promise<Comment[]> {
  const response = await api.get(`/pages/${pageId}/comments`, { headers: authHeaders(user) })
  await expectOk(response, `GET /pages/${pageId}/comments`)
  return (await response.json()) as Comment[]
}

export async function createComment(
  api: APIRequestContext,
  user: Token,
  pageId: string,
  data: CreateCommentData
): Promise<Comment> {
  const response = await api.post(`/pages/${pageId}/comments`, {
    data,
    headers: authHeaders(user),
  })
  await expectOk(response, `POST /pages/${pageId}/comments`)
  return (await response.json()) as Comment
}

export async function updateComment(
  api: APIRequestContext,
  user: Token,
  commentId: string,
  data: UpdateCommentData
): Promise<Comment> {
  const response = await api.patch(`/comments/${commentId}`, { data, headers: authHeaders(user) })
  await expectOk(response, `PATCH /comments/${commentId}`)
  return (await response.json()) as Comment
}

export async function deleteComment(
  api: APIRequestContext,
  user: Token,
  commentId: string
): Promise<void> {
  const response = await api.delete(`/comments/${commentId}`, { headers: authHeaders(user) })
  await expectOk(response, `DELETE /comments/${commentId}`)
}

/** y-websocket room for one page: `WS /pages/{id}/collab`. */
export function pageCollabPath(pageId: string): string {
  return `/pages/${pageId}/collab`
}

/** Workspace events socket: `WS /workspaces/{id}/events`. */
export function workspaceEventsPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/events`
}

/** `GET /public/pages/{public_id}` (no session). */
export async function getPublicPage(api: APIRequestContext, publicId: string): Promise<PublicPage> {
  const response = await api.get(`/public/pages/${publicId}`)
  await expectOk(response, `GET /public/pages/${publicId}`)
  return (await response.json()) as PublicPage
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Error toasts (sonner). Assert with toContainText(title) and the backend message. */
export function errorToast(page: Page) {
  return page.locator('[data-sonner-toast][data-type="error"]')
}

/** The sidebar (`<aside aria-label="Sidebar">`). */
export function sidebar(page: Page) {
  return page.getByRole('complementary', { name: 'Sidebar' })
}

/** A page row in the sidebar tree, found by its title. */
export function sidebarPage(page: Page, title: string) {
  return sidebar(page)
    .getByRole('treeitem')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) })
}

/**
 * Drags with real mouse moves. dnd-kit's PointerSensor needs the intermediate
 * pointer events of a real drag: a single jump (locator.dragTo) can end the
 * drag before the droppable under the pointer was ever computed.
 *
 * `targetPosition` (pixels from the target's top left, like dragTo) drops on a
 * chosen point of the target: y < 28% of a sidebar row drops BEFORE it, y >
 * 72% AFTER it, the middle band drops INSIDE it.
 */
export async function mouseDrag(
  page: Page,
  source: Locator,
  target: Locator,
  targetPosition?: { x: number; y: number }
): Promise<void> {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('drag source or target is not visible')
  const drop = targetPosition
    ? { x: to.x + targetPosition.x, y: to.y + targetPosition.y }
    : { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(drop.x, drop.y, { steps: 15 })
  await page.mouse.up()
}

/** Opens the workspace menu at the top of the sidebar. */
export async function openWorkspaceMenu(page: Page) {
  await sidebar(page).getByRole('button', { name: 'Switch workspace' }).click()
}

/** Logs out through the workspace menu. */
export async function logOut(page: Page) {
  await openWorkspaceMenu(page)
  await page.getByRole('button', { name: 'Log out' }).click()
}

/** The value the app keeps in localStorage for the session, or null when signed out. */
export function storedToken(page: Page): Promise<string | null> {
  return page.evaluate(key => window.localStorage.getItem(key), AUTH_TOKEN_KEY)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NETWORK_CHANGED = 'net::ERR_NETWORK_CHANGED'
const MODULE_LOAD_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed/

/**
 * Watches every page of a browser context during one test:
 *
 * - An uncaught exception in the app (React hydration errors included) fails
 *   the test. Call the returned function after the test to check.
 * - Host network changes are survived. When Docker on the same machine starts
 *   containers or networks, Chromium can abort in-flight requests with
 *   net::ERR_NETWORK_CHANGED, even to 127.0.0.1. If that breaks the loading of
 *   the app's modules, the page never hydrates. That is the machine, not the
 *   app: such a page is reloaded and its module-load error is ignored. Any other
 *   failure (an aborted API call included) still fails the test.
 */
function watchContext(context: BrowserContext): () => void {
  const errors: string[] = []
  const hitByNetworkChange = new WeakSet<Page>()
  const reloads = new WeakMap<Page, number>()
  // Top-level document requests in flight, per page.
  const loading = new Map<Page, Set<Request>>()

  const pageLoad = (request: Request) =>
    request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()

  async function reload(page: Page) {
    // The reload itself can be aborted by the next network change: try again.
    while (!page.isClosed() && (reloads.get(page) ?? 0) < 5) {
      // The test is already loading another page, which replaces the broken one.
      if (loading.get(page)?.size) return
      reloads.set(page, (reloads.get(page) ?? 0) + 1)
      const reloaded = await page.reload().then(
        () => true,
        () => false
      )
      if (reloaded) return
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  context.on('request', request => {
    if (!pageLoad(request)) return
    const page = request.frame().page()
    loading.set(page, (loading.get(page) ?? new Set()).add(request))
  })
  const loaded = (request: Request) => {
    if (pageLoad(request)) loading.get(request.frame().page())?.delete(request)
  }
  context.on('requestfinished', loaded)
  context.on('requestfailed', request => {
    loaded(request)
    if (request.failure()?.errorText === NETWORK_CHANGED) {
      hitByNetworkChange.add(request.frame().page())
    }
  })

  context.on('weberror', webError => {
    const error = webError.error()
    const page = webError.page()
    if (page && hitByNetworkChange.has(page) && MODULE_LOAD_ERROR.test(error.message)) {
      void reload(page)
      return
    }
    errors.push(`${page?.url() ?? ''}\n${error.stack || `${error.name}: ${error.message}`}`)
  })

  return () => {
    if (errors.length > 0) throw new Error(`Uncaught errors in the app:\n\n${errors.join('\n\n')}`)
  }
}

interface Fixtures {
  api: APIRequestContext
  user: TestUser
  loginAs: (user: TestUser) => Promise<Page>
  authedPage: Page
}

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    const assertNoPageErrors = watchContext(context)
    await use(context)
    assertNoPageErrors()
  },

  api: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({ baseURL: BACKEND_URL })
    await use(api)
    await api.dispose()
  },

  user: async ({ api }, use) => {
    await use(await registerUser(api))
  },

  loginAs: async ({ browser }, use) => {
    const opened: { context: BrowserContext; assertNoPageErrors: () => void }[] = []
    await use(async user => {
      // The same thing a real sign-in leaves behind: the session token in localStorage.
      const context = await browser.newContext({
        storageState: {
          cookies: [],
          origins: [
            { origin: FRONTEND_URL, localStorage: [{ name: AUTH_TOKEN_KEY, value: user.token }] },
          ],
        },
      })
      opened.push({ context, assertNoPageErrors: watchContext(context) })
      return context.newPage()
    })
    for (const { context } of opened) await context.close()
    for (const { assertNoPageErrors } of opened) assertNoPageErrors()
  },

  authedPage: async ({ loginAs, user }, use) => {
    await use(await loginAs(user))
  },
})
