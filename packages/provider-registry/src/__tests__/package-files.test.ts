/**
 * Packaging smoke check — the README promises the package "ships static JSON data files", and the app +
 * external consumers read `data/*.json` and import the node readers via `exports`. `npm publish` only
 * ships what `files` matches, so a dropped glob would silently exclude either the catalog or the export
 * targets (broken imports / readers with nothing to read). Two guards:
 *
 *  1. Contract: every `main`/`module`/`types`/`exports` target AND the documented data files are covered
 *     by a `files` glob — build-state-independent, so it catches a regression even before `dist` is built.
 *  2. Tarball: `npm pack` actually ships the data files (always committed); when `dist` has been built it
 *     must also ship every export target.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const DATA_FILES = ['data/models.json', 'data/providers.json', 'data/provider-models.json']

// Every leaf string target declared in main/module/types + the (possibly nested) exports map.
const collectExportTargets = (node: unknown): string[] => {
  if (typeof node === 'string') return node.startsWith('./') ? [node.slice(2)] : []
  if (node && typeof node === 'object') return Object.values(node).flatMap(collectExportTargets)
  return []
}
const exportTargets = [
  ...[pkg.main, pkg.module, pkg.types].filter((t): t is string => typeof t === 'string'),
  ...collectExportTargets(pkg.exports)
]

// Minimal npm-`files` glob → RegExp: escape regex specials, then `**/*` / `**` → `.*`, `*` → non-slash run.
const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/\*/g, '.*')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')}$`
  )
const fileMatchers = (pkg.files as string[]).map(globToRegExp)
const isCovered = (p: string): boolean => fileMatchers.some((re) => re.test(p))

describe('package files contract', () => {
  it('`files` globs cover every export target', () => {
    expect(exportTargets.filter((t) => !isCovered(t))).toEqual([])
  })

  it('`files` globs cover the documented data files', () => {
    expect(DATA_FILES.filter((f) => !isCovered(f))).toEqual([])
  })
})

// Builds `dist` if missing so this never silently skips — a publish must ship BOTH the export targets and
// the data, not just whatever happens to be on disk. CI runs `test:provider-registry` without a prior
// build, so the test owns that guarantee; the release path builds it too (root `packages:build` includes
// `@cherrystudio/provider-registry build`).
describe('npm pack ships the published contract', () => {
  it('packs every export target and all data files', () => {
    if (!existsSync(join(packageRoot, 'dist'))) {
      execFileSync('npm', ['run', 'build'], { cwd: packageRoot, stdio: 'ignore' })
    }
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: packageRoot, encoding: 'utf8' })
    const files = (JSON.parse(out)[0].files as Array<{ path: string }>).map((f) => f.path)
    for (const expected of [...exportTargets, ...DATA_FILES]) {
      expect(files, `${expected} missing from npm pack output — check "files" in package.json`).toContain(expected)
    }
  }, 120_000)
})
