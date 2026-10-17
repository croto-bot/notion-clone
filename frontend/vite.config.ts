import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import { nitro } from 'nitro/vite'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)

/**
 * `virtual:emoji-data` is the emoji list of the `@emoji-mart/data` package as a JS module.
 * Vite's dev server cannot serve that package's JSON file straight from node_modules, and
 * this also keeps dev and build the same. It loads on first use (the emoji picker).
 */
function emojiData(): Plugin {
  const id = 'virtual:emoji-data'
  return {
    name: 'nx-emoji-data',
    resolveId: source => (source === id ? `\0${id}` : undefined),
    load: source =>
      source === `\0${id}`
        ? `export default ${readFileSync(require.resolve('@emoji-mart/data/sets/15/native.json'), 'utf8')}`
        : undefined,
  }
}

const config = defineConfig({
  plugins: [
    emojiData(),
    // The devtools server event bus always listens on port 42069. The e2e stack
    // (E2E_RUNNER_PID is set by playwright.config.ts) turns it off, so a test
    // run can start while `bun run dev` or another checkout's e2e run is up.
    devtools({ eventBusConfig: { enabled: !process.env.E2E_RUNNER_PID } }),
    nitro(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),

    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    // One copy of Yjs: a second one (CJS next to ESM) breaks its instanceof checks.
    dedupe: ['yjs', 'y-protocols', 'y-prosemirror'],
  },
  optimizeDeps: {
    // TanStack Start has no index.html, so Vite finds dependencies only when a
    // page first imports them, then re-bundles and reloads the page (and old
    // module requests fail with "504 Outdated Optimize Dep"). Scanning all app
    // sources at startup bundles everything up front.
    entries: ['src/**/*.{ts,tsx}'],
  },
})

export default config
