/** The demo workspace: what seed() in record.ts creates through the public API. */

export interface SeedPage {
  title: string
  icon: string
  cover?: string
  /** Markdown that the app's own "Import Markdown" turns into blocks. */
  markdown?: string
  children?: SeedPage[]
}

export const WORKSPACE = { name: 'Acme Product', icon: '🛰️' }

export const ADA = { email: 'ada@acme-demo.dev', password: 'Noted-demo-2026', name: 'Ada Lovelace' }
export const GRACE = {
  email: 'grace@acme-demo.dev',
  password: 'Noted-demo-2026',
  name: 'Grace Hopper',
}

export const PAGES: SeedPage[] = [
  {
    title: 'Product Roadmap',
    icon: '🚀',
    cover: 'gradient-1',
    markdown: `Where Acme is going this year, and why.

## Themes

- **Faster onboarding**: a new team is productive in one afternoon.
- **Real-time everything**: every edit shows up for everyone, live.
- **Open by default**: publish any page to the web in one click.

> We ship small, we ship often, and we write it down.
`,
    children: [
      {
        title: 'Q4 Launch Plan',
        icon: '📋',
        cover: 'gradient-4',
        markdown: `The public beta opens on **November 18**. This page is the single source of truth for the launch.

## Goals

- [x] Freeze the feature scope
- [x] Book the launch webinar
- [ ] Finish the onboarding checklist
- [ ] Record the demo videos

## Open questions

Who owns the pricing page copy? Do we need a waitlist?
`,
      },
      {
        title: 'Design System',
        icon: '🎨',
        markdown: `Tokens, components and the rules that keep the product consistent.

## Colors

| Token | Light | Dark |
| --- | --- | --- |
| Text | #37352F | #FFFFFFCF |
| Page | #FFFFFF | #191919 |
| Sidebar | #F7F7F5 | #202020 |
`,
      },
    ],
  },
  {
    title: 'Engineering Wiki',
    icon: '📚',
    cover: 'gradient-3',
    markdown: `Everything an engineer at Acme needs on day one.

## Run the stack

\`\`\`bash
docker compose up -d --build
open http://localhost:3000
\`\`\`

## Principles

1. Every change has an end-to-end test.
2. No mocks: tests drive the real system.
3. Small pull requests, reviewed the same day.
`,
    children: [
      { title: 'Onboarding', icon: '🧭', markdown: 'Your first week at Acme, day by day.\n' },
      {
        title: 'Architecture',
        icon: '🏗️',
        markdown: 'FastAPI, PostgreSQL and React, with Yjs for live editing.\n',
      },
    ],
  },
  {
    title: 'Meeting Notes',
    icon: '🗓️',
    markdown: 'Notes from every team meeting, newest first.\n',
    children: [
      { title: 'Weekly sync', icon: '☕', markdown: '## Decisions\n\n- Beta date confirmed.\n' },
    ],
  },
  { title: 'Reading List', icon: '📖', markdown: '- Shape Up\n- The Pragmatic Programmer\n' },
]

export const TASKS_TITLE = 'Tasks'

/** Rows of the Tasks database: title, Status option name, Tags option names. */
export const TASK_ROWS: { title: string; status: string; tags: string[] }[] = [
  { title: 'Design onboarding flow', status: 'In progress', tags: ['Design'] },
  { title: 'Set up error tracking', status: 'Not started', tags: ['Backend'] },
  { title: 'Write launch blog post', status: 'Not started', tags: ['Marketing'] },
  { title: 'Fix sidebar drag on Safari', status: 'Done', tags: ['Frontend', 'Bug'] },
  { title: 'Plan the beta webinar', status: 'In progress', tags: ['Marketing'] },
  { title: 'Add rate limits to the API', status: 'Done', tags: ['Backend'] },
]

export const TAGS = [
  { name: 'Design', color: 'purple' },
  { name: 'Backend', color: 'blue' },
  { name: 'Frontend', color: 'green' },
  { name: 'Marketing', color: 'orange' },
  { name: 'Bug', color: 'red' },
]
