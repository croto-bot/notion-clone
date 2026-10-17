/**
 * Browser JS coverage of the app's own code (src/), measured during a real e2e run.
 *
 * Off by default. `E2E_COVERAGE=1 bun run test:e2e` (or `make test-e2e-cov`)
 * turns it on: fixtures.ts starts Playwright's page.coverage on every page and
 * hands the V8 data to monocart-coverage-reports, which maps it back to src/
 * files through the source maps that the Vite dev server inlines. The report
 * is written when the run ends (playwright.config.ts globalSetup).
 */
import { fileURLToPath } from 'node:url'
import {
  CoverageReport,
  type CoverageReportOptions,
  type V8CoverageEntry,
} from 'monocart-coverage-reports'
import { transformWithEsbuild } from 'vite'
import { FRONTEND_URL } from './stack'

export const COVERAGE_ENABLED = !!process.env.E2E_COVERAGE

const APP_MODULE = new RegExp(`^${FRONTEND_URL}/src/[^?]+\\.tsx?(\\?|$)`)

const INLINE_SOURCE_MAP =
  /\n\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,(\S+)\s*$/
const REFRESH_FOOTER = '\nimport * as RefreshRuntime from "/@react-refresh";'

interface V8Function {
  ranges: { startOffset: number; endOffset: number; count: number }[]
}

const FRONTEND_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** An absolute path (a file no test loads) as a path relative to frontend/. */
function projectPath(sourcePath: string): string {
  return sourcePath.replace(FRONTEND_ROOT, '')
}

/**
 * Prepares one module the dev server served:
 *
 * - Its inline source map names the file relative to the URL (`Avatar.tsx`).
 *   Name it by its path in the project instead (`src/components/Avatar.tsx`), so
 *   the module and its `?tsr-split=component` part (TanStack Router serves a
 *   route's component as a second module) count as one file.
 * - Drop the React Refresh footer that the dev server appends to components. It
 *   is not app code, and the map does not map it: the report would count its
 *   lines past the end of the file.
 */
function prepareServedModule(entry: V8CoverageEntry): void {
  if (!entry.source || !entry.functions) return
  const inlineMap = INLINE_SOURCE_MAP.exec(entry.source)
  if (!inlineMap) return
  const sourceMap = JSON.parse(Buffer.from(inlineMap[1], 'base64').toString('utf8'))
  sourceMap.sources = [new URL(entry.url).pathname.slice(1)]
  entry.sourceMap = sourceMap
  const footer = entry.source.indexOf(REFRESH_FOOTER)
  const end = footer < 0 ? inlineMap.index : footer
  entry.source = entry.source.slice(0, end)
  entry.functions = entry.functions
    .map((fn: V8Function) => ({
      ...fn,
      ranges: fn.ranges
        .filter(range => range.startOffset < end)
        .map(range => ({ ...range, endOffset: Math.min(range.endOffset, end) })),
    }))
    .filter((fn: V8Function) => fn.ranges.length > 0)
}

export const COVERAGE_OPTIONS: CoverageReportOptions = {
  name: 'Frontend e2e coverage (src/)',
  outputDir: `${FRONTEND_ROOT}coverage`,
  // Only the TypeScript modules the dev server serves from src/: not node_modules,
  // Vite's client, or CSS files (served as JS modules, with a map to the CSS).
  entryFilter: entry => APP_MODULE.test(entry.url),
  sourceFilter: sourcePath => {
    const path = projectPath(sourcePath)
    return path.startsWith('src/') && !path.endsWith('routeTree.gen.ts')
  },
  sourcePath: projectPath,
  onEntry: prepareServedModule,
  // Every src/ file, so a file no test ever loads shows up as 0%. The parser
  // reads JS only: compile those files the way Vite does first.
  all: {
    dir: `${FRONTEND_ROOT}src`,
    filter: { '**/*.d.ts': false, '**/*.{ts,tsx}': 'js', '**/*': false },
    transformer: async entry => {
      const result = await transformWithEsbuild(entry.source, entry.url, { sourcemap: true })
      entry.source = result.code
      entry.sourceMap = result.map
    },
  },
  reports: ['text', 'console-summary', 'json-summary', 'lcovonly', 'html'],
}

/** Adds the V8 coverage of one page to the run's cache (one call per page). */
export async function addCoverage(entries: V8CoverageEntry[]): Promise<void> {
  await new CoverageReport(COVERAGE_OPTIONS).add(entries)
}

/** Clears the cache of the last run, and returns the step that writes the report. */
export default async function coverageRun(): Promise<() => Promise<void>> {
  const report = new CoverageReport(COVERAGE_OPTIONS)
  report.cleanCache()
  return async () => {
    await new CoverageReport(COVERAGE_OPTIONS).generate()
  }
}
