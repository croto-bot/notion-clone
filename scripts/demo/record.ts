/**
 * Records the README demo videos against a running stack (see stack.sh):
 *
 *   node scripts/demo/record.ts [tour] [collaboration] [databases] [share]
 *
 * With no names it records all four. Each scene seeds a fresh demo workspace
 * through the public API, films a real browser at 1920x1080, and encodes
 * docs/media/<scene>.mp4 (H.264) and docs/media/<scene>.gif (first 8 s).
 * A step whose element does not show up throws, and the run exits 1.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import playwright from '../../frontend/node_modules/playwright/index.js'
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Locator,
  Page,
} from '../../frontend/node_modules/playwright/index.js'
import { ADA, GRACE, PAGES, TAGS, TASK_ROWS, TASKS_TITLE, WORKSPACE } from './content.ts'
import type { SeedPage } from './content.ts'

const { chromium, request } = playwright
const ROOT = resolve(import.meta.dirname, '../..')
const OUT = resolve(import.meta.dirname, 'out')
const MEDIA = resolve(ROOT, 'docs/media')
const FRONTEND_URL =
  process.env.DEMO_FRONTEND_URL ?? `http://127.0.0.1:${process.env.DEMO_FRONTEND_PORT ?? 57400}`
const BACKEND_URL =
  process.env.DEMO_BACKEND_URL ?? `http://127.0.0.1:${process.env.DEMO_BACKEND_PORT ?? 57195}`
const FULL_HD = { width: 1920, height: 1080 }
const HALF_HD = { width: 960, height: 1080 }
const STEP_TIMEOUT = 15_000

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

// ---------------------------------------------------------------------------
// Seeding through the public API
// ---------------------------------------------------------------------------

interface Account {
  email: string
  password: string
  name: string
  token: string
  id: string
}

interface Seeded {
  ada: Account
  grace: Account
  workspaceId: string
  ids: Map<string, string>
}

async function call<T>(
  api: APIRequestContext,
  method: string,
  path: string,
  token?: string,
  data?: unknown
): Promise<T> {
  const response = await api.fetch(path, {
    method,
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok())
    throw new Error(`${method} ${path}: HTTP ${response.status()} ${await response.text()}`)
  return (response.status() === 204 ? undefined : await response.json()) as T
}

/** Signs in, or registers on the first run. Safe to rerun against the same database. */
async function account(api: APIRequestContext, who: typeof ADA): Promise<Account> {
  const login = await api.post('/auth/login', {
    data: { email: who.email, password: who.password },
  })
  const session = login.ok()
    ? await login.json()
    : await call<{ id: string }>(api, 'POST', '/auth/register', undefined, {
        email: who.email,
        raw_password: who.password,
        display_name: who.name,
      })
  const me = await call<{ id: string }>(api, 'GET', '/users/me', session.id)
  return { ...who, token: session.id, id: me.id }
}

async function createPages(
  api: APIRequestContext,
  s: Seeded,
  pages: SeedPage[],
  parentId?: string
) {
  for (const spec of pages) {
    const page = await call<{ id: string }>(api, 'POST', '/pages', s.ada.token, {
      workspace_id: s.workspaceId,
      parent_id: parentId,
      title: spec.title,
      icon: spec.icon,
    })
    if (spec.cover)
      await call(api, 'PATCH', `/pages/${page.id}`, s.ada.token, { cover: spec.cover })
    s.ids.set(spec.title, page.id)
    await createPages(api, s, spec.children ?? [], page.id)
  }
}

async function createTasks(api: APIRequestContext, s: Seeded) {
  type Property = {
    id: string
    name: string
    type: string
    options?: { id: string; name: string; color: string }[]
  }
  const db = await call<{ id: string; database_schema: Property[] }>(
    api,
    'POST',
    '/pages',
    s.ada.token,
    {
      workspace_id: s.workspaceId,
      kind: 'database',
      title: TASKS_TITLE,
      icon: '✅',
    }
  )
  s.ids.set(TASKS_TITLE, db.id)
  const schema = db.database_schema.map(property =>
    property.name === 'Tags'
      ? { ...property, options: TAGS.map(tag => ({ id: `tag-${tag.name.toLowerCase()}`, ...tag })) }
      : property
  )
  await call(api, 'PATCH', `/pages/${db.id}`, s.ada.token, { database_schema: schema })
  const status = schema.find(property => property.name === 'Status')!
  const tags = schema.find(property => property.name === 'Tags')!
  const optionId = (property: Property, name: string) => {
    const option = property.options?.find(item => item.name === name)
    if (!option) throw new Error(`no option ${name} in ${property.name}`)
    return option.id
  }
  for (const row of TASK_ROWS) {
    await call(api, 'POST', '/pages', s.ada.token, {
      workspace_id: s.workspaceId,
      parent_id: db.id,
      title: row.title,
      properties: {
        [status.id]: optionId(status, row.status),
        [tags.id]: row.tags.map(tag => optionId(tags, tag)),
      },
    })
  }
}

/** Fills each page through the app's own Markdown import, in a context that is not filmed. */
async function importContent(browser: Browser, s: Seeded) {
  const context = await signedIn(browser, s.ada, FULL_HD)
  const page = await context.newPage()
  const walk = (pages: SeedPage[]): SeedPage[] =>
    pages.flatMap(item => [item, ...walk(item.children ?? [])])
  for (const spec of walk(PAGES)) {
    if (!spec.markdown) continue
    await page.goto(`/p/${s.ids.get(spec.title)}`)
    const editor = page.getByTestId('editor')
    await need(editor, `editor of ${spec.title}`)
    await page.getByTestId('import-markdown-input').setInputFiles({
      name: 'content.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(spec.markdown),
    })
    const firstLine = spec.markdown
      .split('\n')[0]
      .replace(/[#*>`-]/g, '')
      .trim()
      .split(' ')
      .slice(0, 3)
      .join(' ')
    await need(editor.getByText(firstLine).first(), `imported content of ${spec.title}`)
    // The collab server stores the document about 1 s after the last update.
    await sleep(1500)
  }
  await context.close()
}

/** A fresh workspace with the demo content, owned by Ada, with Grace as an editor. */
async function seed(browser: Browser): Promise<Seeded> {
  const api = await request.newContext({ baseURL: BACKEND_URL })
  const ada = await account(api, ADA)
  const grace = await account(api, GRACE)
  for (const who of [ada, grace]) {
    for (const old of await call<{ id: string; owner_id: string }[]>(
      api,
      'GET',
      '/workspaces',
      who.token
    )) {
      if (old.owner_id === who.id) await call(api, 'DELETE', `/workspaces/${old.id}`, who.token)
    }
  }
  const workspace = await call<{ id: string }>(api, 'POST', '/workspaces', ada.token, WORKSPACE)
  await call(api, 'POST', `/workspaces/${workspace.id}/members`, ada.token, {
    email: grace.email,
    role: 'editor',
  })
  const s: Seeded = { ada, grace, workspaceId: workspace.id, ids: new Map() }
  await createPages(api, s, PAGES)
  await createTasks(api, s)
  await importContent(browser, s)
  // Visits fill "Recently visited" on Home, oldest first.
  for (const title of [
    'Reading List',
    TASKS_TITLE,
    'Engineering Wiki',
    'Product Roadmap',
    'Q4 Launch Plan',
  ]) {
    await call(api, 'GET', `/pages/${s.ids.get(title)}`, ada.token)
  }
  await api.dispose()
  return s
}

// ---------------------------------------------------------------------------
// Filming: a visible cursor, eased mouse moves, typing at human speed
// ---------------------------------------------------------------------------

/** Headless Chromium paints no cursor: draw one that follows the real mouse events. */
const CURSOR_SCRIPT = `(() => {
  const key = 'demo-cursor-position'
  let el = null
  const place = (x, y) => {
    if (!el) {
      el = document.createElement('div')
      el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.6-4.4 2.9 6.6 3-1.3-2.9-6.5h6.3z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
      el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:scale 80ms'
      document.body.appendChild(el)
    }
    if (!el.isConnected) document.body.appendChild(el)
    el.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)'
    sessionStorage.setItem(key, x + ',' + y)
  }
  addEventListener('mousemove', e => place(e.clientX, e.clientY), true)
  addEventListener('mousedown', () => el && (el.style.scale = '0.85'), true)
  addEventListener('mouseup', () => el && (el.style.scale = '1'), true)
  addEventListener('DOMContentLoaded', () => {
    const saved = sessionStorage.getItem(key)
    if (saved) setTimeout(() => place(...saved.split(',').map(Number)), 500)
  })
})()`

/** One filmed browser page, with where its mouse is and when its video started. */
interface Actor {
  page: Page
  x: number
  y: number
  startedAt: number
}

async function need(locator: Locator, what: string): Promise<Locator> {
  try {
    await locator.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  } catch {
    const shot = resolve(OUT, `failed-${Date.now()}.png`)
    await locator
      .page()
      .screenshot({ path: shot })
      .catch(() => undefined)
    throw new Error(`demo step failed: "${what}" is not visible (${locator}). Screenshot: ${shot}`)
  }
  return locator
}

async function signedIn(
  browser: Browser,
  who: Account,
  size: { width: number; height: number },
  video = false
) {
  return browser.newContext({
    baseURL: FRONTEND_URL,
    viewport: size,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    storageState: {
      cookies: [],
      origins: [{ origin: FRONTEND_URL, localStorage: [{ name: 'auth_token', value: who.token }] }],
    },
    ...(video ? { recordVideo: { dir: OUT, size } } : {}),
  })
}

async function film(context: BrowserContext): Promise<Actor> {
  await context.addInitScript(CURSOR_SCRIPT)
  const page = await context.newPage()
  return { page, x: 960, y: 540, startedAt: Date.now() }
}

/** Seconds since the actor's video started: where an edit cuts. */
const at = (actor: Actor) => (Date.now() - actor.startedAt) / 1000

async function moveTo(actor: Actor, x: number, y: number) {
  const distance = Math.hypot(x - actor.x, y - actor.y)
  const steps = Math.round(Math.min(45, Math.max(10, distance / 22)))
  const from = { x: actor.x, y: actor.y }
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    await actor.page.mouse.move(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased)
    await sleep(12)
  }
  actor.x = x
  actor.y = y
}

async function point(
  actor: Actor,
  locator: Locator,
  what: string,
  offset?: { x: number; y: number }
) {
  await need(locator, what)
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`demo step failed: "${what}" has no box`)
  await moveTo(actor, box.x + (offset?.x ?? box.width / 2), box.y + (offset?.y ?? box.height / 2))
}

async function click(
  actor: Actor,
  locator: Locator,
  what: string,
  offset?: { x: number; y: number }
) {
  await point(actor, locator, what, offset)
  await sleep(120)
  await actor.page.mouse.down()
  await sleep(60)
  await actor.page.mouse.up()
  await sleep(250)
}

async function type(actor: Actor, text: string, delay = 55) {
  for (const char of text) {
    await actor.page.keyboard.type(char)
    await sleep(delay + Math.random() * delay * 0.6)
  }
}

/** Several people typing at once, one character each in turn. */
async function typeTogether(lines: { actor: Actor; text: string }[]) {
  const longest = Math.max(...lines.map(line => line.text.length))
  for (let i = 0; i < longest; i++) {
    for (const line of lines) if (line.text[i]) await line.actor.page.keyboard.type(line.text[i])
    await sleep(90 + Math.random() * 50)
  }
}

async function press(actor: Actor, keys: string, pause = 300) {
  await actor.page.keyboard.press(keys)
  await sleep(pause)
}

/** Drags with a held mouse button and eased moves, so dnd-kit sees a real drag. */
async function drag(
  actor: Actor,
  source: Locator,
  target: Locator,
  what: string,
  drop?: { x: number; y: number }
) {
  await point(actor, source, `${what} (source)`)
  await actor.page.mouse.down()
  await moveTo(actor, actor.x + 6, actor.y + 6)
  await point(actor, target, `${what} (target)`, drop)
  await sleep(350)
  await actor.page.mouse.up()
  await sleep(600)
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' })
const sidebarRow = (page: Page, title: string) =>
  sidebar(page)
    .getByRole('treeitem')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) })
    .first()
const sidebarLink = (page: Page, title: string) =>
  sidebarRow(page, title).getByRole('link', { name: title, exact: true }).first()

async function openFromSidebar(actor: Actor, title: string) {
  await click(actor, sidebarLink(actor.page, title), `sidebar link ${title}`)
  await need(actor.page.getByLabel('Page title'), `title of ${title}`)
}

async function waitForEditor(actor: Actor, text: string) {
  await need(actor.page.getByTestId('editor').getByText(text).first(), `editor text "${text}"`)
}

// ---------------------------------------------------------------------------
// Encoding with ffmpeg
// ---------------------------------------------------------------------------

interface Clip {
  file: string
  from: number
  to?: number
}

function ffmpeg(args: string[]) {
  const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  if (run.status !== 0) throw new Error(`ffmpeg failed: ffmpeg ${args.join(' ')}`)
}

function trim(index: number, clip: Clip, width: number) {
  const end = clip.to === undefined ? '' : `:end=${clip.to.toFixed(2)}`
  return `[${index}:v]trim=start=${clip.from.toFixed(2)}${end},setpts=PTS-STARTPTS,fps=30,scale=${width}:1080:flags=lanczos,setsar=1`
}

/** Writes docs/media/<name>.mp4 from clips played one after another (or side by side) and its GIF preview. */
function encode(name: string, clips: Clip[], layout: 'sequence' | 'side-by-side' = 'sequence') {
  const inputs = clips.flatMap(clip => ['-i', clip.file])
  const width = layout === 'side-by-side' ? 960 : 1920
  const parts = clips.map((clip, i) => `${trim(i, clip, width)}[v${i}]`)
  const labels = clips.map((_, i) => `[v${i}]`).join('')
  const join =
    layout === 'side-by-side'
      ? `${labels}hstack=inputs=${clips.length}:shortest=1,drawbox=x=959:y=0:w=2:h=ih:color=0x37352F@0.3:t=fill,format=yuv420p[v]`
      : `${labels}concat=n=${clips.length}:v=1:a=0,format=yuv420p[v]`
  const mp4 = resolve(MEDIA, `${name}.mp4`)
  ffmpeg([
    ...inputs,
    '-filter_complex',
    [...parts, join].join(';'),
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    mp4,
  ])
  ffmpeg([
    '-t',
    '8',
    '-i',
    mp4,
    '-vf',
    'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
    resolve(MEDIA, `${name}.gif`),
  ])
  const mb = (file: string) => (statSync(file).size / 1e6).toFixed(1)
  console.log(
    `demo: ${name}.mp4 ${mb(mp4)} MB, ${name}.gif ${mb(resolve(MEDIA, `${name}.gif`))} MB`
  )
}

async function videoFile(actor: Actor): Promise<string> {
  const video = actor.page.video()
  if (!video) throw new Error('the page records no video')
  await actor.page.context().close()
  return video.path()
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

async function tour(browser: Browser, s: Seeded) {
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    viewport: FULL_HD,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    recordVideo: { dir: OUT, size: FULL_HD },
  })
  const me = await film(context)
  const { page } = me
  await page.goto('/')
  await need(page.getByRole('link', { name: 'Get Noted free' }).first(), 'landing call to action')
  await sleep(400)
  const start = at(me) - 0.2
  await point(me, page.getByRole('heading', { level: 1 }), 'landing heading')
  await sleep(1500)
  await click(me, page.getByRole('link', { name: 'Log in' }).first(), 'Log in link')
  await click(me, page.getByLabel('Email'), 'email field')
  await type(me, s.ada.email, 35)
  await click(me, page.getByLabel('Password'), 'password field')
  await type(me, s.ada.password, 30)
  const continueButton = page.getByRole('button', { name: 'Continue' })
  await point(me, continueButton, 'Continue button')
  await sleep(300)
  // The edit cuts from this click straight to Home: the loading splash and its fades stay out.
  const signInEnd = at(me) + 0.15
  await click(me, continueButton, 'Continue button')
  await need(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }),
    'home greeting'
  )
  await need(
    page.getByRole('region', { name: 'Recently visited' }).getByText('Q4 Launch Plan'),
    'recent pages'
  )
  await sleep(800)
  const homeStart = at(me)
  await sleep(1500)

  await click(
    me,
    sidebar(page).getByRole('button', { name: 'Expand Product Roadmap' }),
    'expand Product Roadmap'
  )
  await need(sidebarLink(page, 'Q4 Launch Plan'), 'child page in the tree')
  await sleep(700)
  await drag(
    me,
    sidebarRow(page, 'Reading List'),
    sidebarRow(page, 'Engineering Wiki'),
    'reorder Reading List',
    {
      x: 100,
      y: 5,
    }
  )
  await sleep(900)

  await openFromSidebar(me, 'Q4 Launch Plan')
  await need(page.getByTestId('page-cover'), 'page cover')
  await waitForEditor(me, 'Open questions')
  await sleep(1500)
  const editor = page.getByTestId('editor')
  await click(me, editor.getByText('Who owns the pricing page copy?'), 'last paragraph')
  await press(me, 'End', 150)
  const pick = async (typed: string, item: string) => {
    await press(me, 'Enter', 200)
    await type(me, `/${typed}`, 70)
    await sleep(350)
    await click(
      me,
      page.locator('.bn-suggestion-menu').getByText(item, { exact: true }),
      `slash item ${item}`
    )
  }
  await pick('heading 2', 'Heading 2')
  await type(me, 'Launch day')
  await pick('todo', 'To-do list')
  await type(me, 'Send the announcement email')
  await pick('toggle', 'Toggle list')
  await type(me, 'Rollback plan')
  await pick('code', 'Code')
  await type(me, 'make deploy ENV=production', 45)
  await sleep(600)

  await click(me, editor.getByText('Send the announcement email'), 'to-do text', { x: 400, y: 10 })
  await press(me, 'End', 100)
  await press(me, 'Shift+Home', 500)
  const toolbar = page.locator('.bn-formatting-toolbar')
  await click(me, toolbar.locator('[data-test="bold"]'), 'bold button')
  await click(me, toolbar.locator('[data-test="italic"]'), 'italic button')
  await sleep(900)

  await press(me, 'Control+k', 500)
  const quickFind = page.getByRole('dialog', { name: 'Quick find' })
  await need(quickFind, 'quick find')
  await type(me, 'wiki', 120)
  await need(quickFind.getByText('Best matches'), 'search results')
  await need(quickFind.locator('[cmdk-item]', { hasText: 'Engineering Wiki' }), 'search result')
  await sleep(600)
  if ((await quickFind.locator('[cmdk-item]').count()) !== 1)
    throw new Error('demo step failed: "wiki" should find one page')
  await press(me, 'ArrowDown', 300)
  await need(
    quickFind.locator('[cmdk-item][data-selected="true"]', { hasText: 'Engineering Wiki' }),
    'selected search result'
  )
  await sleep(900)
  await press(me, 'Enter', 400)
  await waitForEditor(me, 'Run the stack')
  await sleep(1200)
  await press(me, 'Control+Shift+L', 400)
  await need(page.locator('html.dark'), 'dark theme')
  await moveTo(me, 1200, 600)
  await sleep(2500)
  const tourFile = await videoFile(me)
  encode('tour', [
    { file: tourFile, from: start, to: signInEnd },
    { file: tourFile, from: homeStart },
  ])
}

async function collaboration(browser: Browser, s: Seeded) {
  const ada = await film(await signedIn(browser, s.ada, HALF_HD, true))
  const grace = await film(await signedIn(browser, s.grace, HALF_HD, true))
  const url = `/p/${s.ids.get('Q4 Launch Plan')}`
  await Promise.all([ada.page.goto(url), grace.page.goto(url)])
  await Promise.all([waitForEditor(ada, 'Open questions'), waitForEditor(grace, 'Open questions')])
  for (const [actor, other] of [
    [ada, s.grace.name],
    [grace, s.ada.name],
  ] as const) {
    await need(
      actor.page.getByTestId('presence-avatars').getByRole('img', { name: other }),
      `presence of ${other}`
    )
  }
  await sleep(800)
  const startAda = at(ada)
  const startGrace = at(grace)
  await sleep(800)
  await point(ada, ada.page.getByTestId('presence-avatars'), 'presence avatars on Ada side')
  await point(grace, grace.page.getByTestId('presence-avatars'), 'presence avatars on Grace side')
  await sleep(1500)

  await click(
    ada,
    ada.page.getByTestId('editor').getByText('Do we need a waitlist?'),
    'Ada paragraph',
    { x: 5, y: 10 }
  )
  await press(ada, 'End', 100)
  await press(ada, 'Enter', 200)
  await click(
    grace,
    grace.page.getByTestId('editor').getByText('Record the demo videos'),
    'Grace to-do'
  )
  await press(grace, 'End', 100)
  await press(grace, 'Enter', 200)
  await typeTogether([
    { actor: ada, text: 'Ada: I will write the pricing page copy by Friday.' },
    { actor: grace, text: 'Publish the changelog' },
  ])
  await need(
    grace.page.locator('.bn-collaboration-cursor__label', { hasText: 'Ada' }),
    'Ada cursor on Grace side'
  )
  await need(
    ada.page.locator('.bn-collaboration-cursor__label', { hasText: 'Grace' }),
    'Grace cursor on Ada side'
  )
  await waitForEditor(grace, 'by Friday.')
  await waitForEditor(ada, 'Publish the changelog')
  await sleep(1500)

  await click(
    grace,
    grace.page.getByTestId('editor').getByText('by Friday.'),
    'Ada line on Grace side',
    { x: 400, y: 10 }
  )
  await press(grace, 'End', 100)
  await press(grace, 'Enter', 200)
  const checkbox = ada.page
    .getByTestId('editor')
    .locator('[data-content-type="checkListItem"]', { hasText: 'Finish the onboarding checklist' })
    .locator('input')
  await typeTogether([{ actor: grace, text: 'Grace: I can review it on Monday.' }])
  await click(ada, checkbox, 'onboarding checkbox')
  await need(
    grace.page
      .getByTestId('editor')
      .locator('[data-content-type="checkListItem"][data-checked="true"]', {
        hasText: 'Finish the onboarding checklist',
      }),
    'checked on Grace side'
  )
  await waitForEditor(ada, 'review it on Monday.')
  await sleep(2500)

  await click(
    grace,
    sidebar(grace.page).getByRole('button', { name: 'New page' }),
    'New page in the sidebar'
  )
  const title = grace.page.getByLabel('Page title')
  await need(title, 'new page title')
  await click(grace, title, 'new page title')
  await type(grace, 'Launch retro', 90)
  await press(grace, 'Enter', 300)
  await need(sidebarLink(ada.page, 'Launch retro'), 'live sidebar on Ada side')
  await point(ada, sidebarLink(ada.page, 'Launch retro'), 'new page in Ada sidebar')
  await sleep(3000)
  const [adaFile, graceFile] = await Promise.all([videoFile(ada), videoFile(grace)])
  encode(
    'collaboration',
    [
      { file: adaFile, from: startAda },
      { file: graceFile, from: startGrace },
    ],
    'side-by-side'
  )
}

async function databases(browser: Browser, s: Seeded) {
  const me = await film(await signedIn(browser, s.ada, FULL_HD, true))
  const { page } = me
  await page.goto('/home')
  await need(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }),
    'home greeting'
  )
  await sleep(500)
  const start = at(me) - 0.2
  await openFromSidebar(me, TASKS_TITLE)
  await need(page.getByRole('row', { name: 'Design onboarding flow' }), 'seeded rows')
  await sleep(1500)

  await click(me, page.getByRole('button', { name: 'New row' }), 'New row button')
  await need(page.getByLabel('Row title'), 'row title input')
  await type(me, 'Record the demo videos')
  await press(me, 'Enter', 500)
  await need(page.getByRole('row', { name: 'Record the demo videos' }), 'new row')
  await click(
    me,
    page.getByRole('button', { name: 'Status of Record the demo videos' }),
    'status cell'
  )
  await click(
    me,
    page.getByRole('button', { name: 'In progress', exact: true }).last(),
    'In progress option'
  )
  await press(me, 'Escape', 600)

  await click(me, page.getByRole('button', { name: 'Add a property' }), 'Add a property')
  await click(
    me,
    page.getByRole('list', { name: 'New property type' }).getByRole('button', { name: 'Date' }),
    'Date type'
  )
  await need(page.getByRole('columnheader').filter({ hasText: 'Date' }), 'new Date column')
  await press(me, 'Escape', 800)

  await click(me, page.getByRole('button', { name: 'Filter' }), 'Filter button')
  await click(me, page.getByRole('button', { name: 'Add a filter' }), 'Add a filter')
  await page.getByLabel('Filter property').selectOption({ label: 'Status' })
  await sleep(400)
  await page.getByLabel('Filter operator').selectOption({ label: 'Is' })
  await sleep(400)
  await page.getByLabel('Filter value').selectOption({ label: 'In progress' })
  await need(page.getByRole('row', { name: 'Plan the beta webinar' }), 'filtered rows')
  await sleep(1800)
  await click(me, page.getByRole('button', { name: 'Delete filter' }), 'Delete filter')
  await press(me, 'Escape', 400)
  await click(me, page.getByRole('button', { name: 'Sort', exact: true }), 'Sort button')
  await click(me, page.getByRole('button', { name: 'Add a sort' }), 'Add a sort')
  await page.getByLabel('Sort property').selectOption({ label: 'Name' })
  await sleep(1500)
  await press(me, 'Escape', 600)

  await click(me, page.getByRole('button', { name: 'Add a view' }), 'Add a view')
  await click(me, page.getByRole('menuitem', { name: 'Board' }), 'Board view')
  await need(page.getByTestId('database-board'), 'board')
  await sleep(1500)
  const done = page.getByTestId('board-column').filter({ hasText: 'Done' })
  await drag(
    me,
    page.getByRole('button', { name: 'Drag Set up error tracking' }),
    done,
    'card to Done'
  )
  await need(done.getByText('Set up error tracking'), 'card in Done')
  await sleep(1500)

  await click(
    me,
    page.getByRole('button', { name: 'Design onboarding flow', exact: true }),
    'board card'
  )
  await need(page.getByTestId('row-properties'), 'row properties')
  await sleep(1000)
  await click(me, page.getByTestId('editor'), 'row editor')
  await type(me, 'Draft the three onboarding screens and test them with five users.')
  await sleep(2500)
  encode('databases', [{ file: await videoFile(me), from: start }])
}

async function share(browser: Browser, s: Seeded) {
  const me = await film(await signedIn(browser, s.ada, FULL_HD, true))
  const { page } = me
  await page.goto(`/p/${s.ids.get('Engineering Wiki')}`)
  await waitForEditor(me, 'Run the stack')
  await sleep(500)
  const start = at(me) - 0.2
  await sleep(1000)
  await click(me, page.getByRole('button', { name: 'Share', exact: true }), 'Share button')
  await sleep(800)
  await click(me, page.getByRole('tab', { name: 'Publish' }), 'Publish tab')
  await click(me, page.getByRole('switch', { name: 'Publish to web' }), 'Publish to web switch')
  const link = page.getByLabel('Public link')
  await need(link, 'public link')
  const publicUrl = await link.inputValue()
  await point(me, link, 'public link')
  await sleep(2000)
  const cutAway = at(me)

  const visitor = await film(
    await browser.newContext({
      viewport: FULL_HD,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      recordVideo: { dir: OUT, size: FULL_HD },
    })
  )
  await visitor.page.goto(publicUrl)
  await need(
    visitor.page.getByRole('heading', { level: 1, name: 'Engineering Wiki' }),
    'public page title'
  )
  await need(visitor.page.getByText('Run the stack'), 'public page content')
  await sleep(300)
  const visitorStart = at(visitor)
  await sleep(1200)
  await moveTo(visitor, 900, 700)
  await visitor.page.mouse.wheel(0, 500)
  await sleep(2000)
  await visitor.page.mouse.wheel(0, -500)
  await sleep(1200)
  const visitorEnd = at(visitor)
  const visitorFile = await videoFile(visitor)

  await press(me, 'Escape', 300)
  const cutBack = at(me)
  await sleep(500)
  await click(me, page.getByRole('button', { name: 'Page options' }), 'Page options')
  await click(me, page.getByRole('menuitem', { name: 'Delete' }), 'Delete menu item')
  const undo = page.getByRole('button', { name: 'Undo' })
  await need(undo, 'undo toast')
  await sleep(1500)
  await click(me, undo, 'Undo')
  await need(sidebarLink(page, 'Engineering Wiki'), 'restored page in the sidebar')
  await sleep(1200)

  await click(me, sidebarLink(page, 'Reading List'), 'Reading List')
  await waitForEditor(me, 'Shape Up')
  await click(me, page.getByRole('button', { name: 'Page options' }), 'Page options')
  await click(me, page.getByRole('menuitem', { name: 'Delete' }), 'Delete menu item')
  await need(page.getByRole('button', { name: 'Undo' }), 'undo toast')
  await sleep(1200)
  await click(me, sidebar(page).getByRole('button', { name: 'Trash' }), 'Trash')
  await click(me, page.getByRole('button', { name: 'Restore Reading List' }), 'Restore from Trash')
  await need(sidebarLink(page, 'Reading List'), 'restored from Trash')
  await press(me, 'Escape', 300)
  await sleep(2000)
  const adaFile = await videoFile(me)
  encode('share', [
    { file: adaFile, from: start, to: cutAway },
    { file: visitorFile, from: visitorStart, to: visitorEnd },
    { file: adaFile, from: cutBack },
  ])
}

// ---------------------------------------------------------------------------

const SCENES = { tour, collaboration, databases, share }

async function main() {
  const names = process.argv.slice(2)
  const unknown = names.filter(name => !(name in SCENES))
  if (unknown.length)
    throw new Error(
      `unknown scene ${unknown.join(', ')}; pick from ${Object.keys(SCENES).join(', ')}`
    )
  const health = await fetch(`${BACKEND_URL}/health`).catch(() => null)
  if (!health?.ok)
    throw new Error(`no backend on ${BACKEND_URL}: run scripts/demo/stack.sh up first`)
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(MEDIA, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const name of names.length ? names : Object.keys(SCENES)) {
      console.log(`demo: recording ${name}`)
      const s = await seed(browser)
      await SCENES[name as keyof typeof SCENES](browser, s)
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
