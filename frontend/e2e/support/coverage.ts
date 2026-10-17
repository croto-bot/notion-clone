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

const FRONTEND_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export const COVERAGE_OPTIONS: CoverageReportOptions = {
  name: 'Frontend e2e coverage (src/)',
  outputDir: `${FRONTEND_ROOT}coverage`,
  // Only the TypeScript modules the dev server serves from src/: not node_modules,
  // Vite's client, or CSS files (served as JS modules, with a map to the CSS).
  entryFilter: entry => APP_MODULE.test(entry.url),
  sourceFilter: sourcePath =>
    sourcePath.startsWith('src/') && !sourcePath.endsWith('routeTree.gen.ts'),
  sourcePath: sourcePath => sourcePath.replace(FRONTEND_ROOT, ''),
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
