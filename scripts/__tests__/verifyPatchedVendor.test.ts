/**
 * Contract for the patched-vendor build guard: a patched dependency that IS
 * bundled without any marker its patch adds must fail the build (the v2.0.8
 * shipped-bundle failure, #19116), while a patched dependency that is not part
 * of this bundle, or whose markers are present, must pass.
 *
 * CI does not run `electron-vite build`, so without this the guard's extraction
 * and bundled-heuristics can rot silently — same contract note as
 * checkChunkExports.test.ts.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractMarkers, loadPatchedDependencies, patchedVendorGuardPlugin } from '../verifyPatchedVendor'

// createRequire must resolve the "installed" dependency from the fixture root,
// not from this file — the plugin builds it from rootDir/node_modules, so a
// fixture package.json with an exports map pointing at the dist file suffices.
function buildFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'patched-vendor-guard-'))
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    [
      'packages:',
      '  - packages/*',
      'patchedDependencies:',
      "  'fake-vendor@1.0.0': patches/fake-vendor.patch",
      "  'renderer-only-vendor@1.0.0': patches/renderer-only.patch",
      '  no-marker-skip: not-a-real-patch-entry'
    ].join('\n')
  )
  mkdirSync(join(root, 'patches'), { recursive: true })
  writeFileSync(
    join(root, 'patches', 'fake-vendor.patch'),
    [
      '--- a/dist/index.js',
      '+++ b/dist/index.js',
      '@@ -1,3 +1,9 @@',
      ' module.exports = {}',
      '+function postImageRequestWrapper(url, body) {',
      "+  const retryStatusCodes = 'STATUS_400_OR_422'",
      '+  return fetch(url, body)',
      '+}',
      '-module.exports = {}'
    ].join('\n')
  )
  writeFileSync(
    join(root, 'patches', 'renderer-only.patch'),
    [
      '--- a/dist/index.js',
      '+++ b/dist/index.js',
      '@@ -1,2 +1,4 @@',
      "+const rendererMarkerLiteral = 'RENDERER_ONLY_PATCH_MARKER_XY'",
      '+void rendererMarkerLiteral'
    ].join('\n')
  )
  mkdirSync(join(root, 'node_modules', 'fake-vendor', 'dist'), { recursive: true })
  writeFileSync(
    join(root, 'node_modules', 'fake-vendor', 'package.json'),
    JSON.stringify({ name: 'fake-vendor', version: '1.0.0', main: 'dist/index.js' })
  )
  // Long literals sampled for the bundled-signal; the PATCHED marker is absent
  // on purpose — this fixture is the "built from unpatched sources" case.
  writeFileSync(
    join(root, 'node_modules', 'fake-vendor', 'dist', 'index.js'),
    [
      'const unpatchedLiteralOne = "UNPATCHED_SAMPLE_LITERAL_ALPHA"',
      'const unpatchedLiteralTwo = "UNPATCHED_SAMPLE_LITERAL_BETA"',
      'module.exports = {}'
    ].join('\n')
  )
  mkdirSync(join(root, 'node_modules', 'renderer-only-vendor', 'dist'), { recursive: true })
  writeFileSync(
    join(root, 'node_modules', 'renderer-only-vendor', 'package.json'),
    JSON.stringify({ name: 'renderer-only-vendor', version: '1.0.0', main: 'dist/index.js' })
  )
  writeFileSync(
    join(root, 'node_modules', 'renderer-only-vendor', 'dist', 'index.js'),
    'const rendererOnlySample = "RENDERER_ONLY_NOT_IN_MAIN_BUNDLE"\nmodule.exports = {}'
  )
  return root
}

const fixtures: string[] = []
afterEach(() => {
  while (fixtures.length) rmSync(fixtures.pop()!, { recursive: true, force: true })
})

function runGuard(root: string, bundle: Record<string, string>): string | null {
  const plugin = patchedVendorGuardPlugin({ rootDir: root })
  const hook = plugin.generateBundle as (
    this: { error: (message: string) => never },
    options: unknown,
    bundle: unknown
  ) => void
  try {
    hook.call(
      {
        error: (message) => {
          throw new Error(message)
        }
      },
      {},
      Object.fromEntries(Object.entries(bundle).map(([fileName, code]) => [fileName, { type: 'chunk', code }]))
    )
    return null
  } catch (error) {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
}

describe('extractMarkers', () => {
  it('collects string literals and long identifiers from added lines only', () => {
    const markers = extractMarkers(
      [
        '--- a/dist/index.js',
        '+++ b/dist/index.js',
        '@@ -1,2 +1,5 @@',
        " existing = 'kept-out-of-markers'", // context line: ignored
        '+function postImageRequestWrapper() {}',
        "+  const code = 'STATUS_400_OR_422'",
        '-removed = "removed-literal-should-not-count"',
        '+short = "abc"',
        '+ tinyIdent'
      ].join('\n')
    )
    expect(markers.identifiers).toContain('postImageRequestWrapper')
    expect(markers.literals).toContain('STATUS_400_OR_422')
    expect(markers.literals).not.toContain('kept-out-of-markers')
    expect(markers.literals).not.toContain('removed-literal-should-not-count')
    expect(markers.literals).not.toContain('abc')
    expect(markers.identifiers).not.toContain('tinyIdent')
  })
})

describe('loadPatchedDependencies', () => {
  it('loads patch entries with extracted markers', () => {
    const root = buildFixture()
    fixtures.push(root)
    const patched = loadPatchedDependencies(root)
    const names = patched.map((dep) => dep.key)
    expect(names).toContain('fake-vendor@1.0.0')
    expect(names).toContain('renderer-only-vendor@1.0.0')
    const fake = patched.find((dep) => dep.key === 'fake-vendor@1.0.0')!
    expect(fake.identifierMarkers).toContain('postImageRequestWrapper')
    expect(fake.literalMarkers).toContain('STATUS_400_OR_422')
    expect(fake.name).toBe('fake-vendor')
  })
})

describe('patchedVendorGuardPlugin', () => {
  it('fails when a patched dependency is bundled without its patch (#19116)', () => {
    const root = buildFixture()
    fixtures.push(root)
    // The bundle carries the dependency's unpatched literals but no patch marker.
    const message = runGuard(root, {
      'vendor.js': 'const a="UNPATCHED_SAMPLE_LITERAL_ALPHA";const b="UNPATCHED_SAMPLE_LITERAL_BETA";'
    })
    expect(message).toMatch(/fake-vendor@1\.0\.0 is bundled without its patch/)
  })

  it('passes when the patch markers are present in the bundle', () => {
    const root = buildFixture()
    fixtures.push(root)
    const message = runGuard(root, {
      'vendor.js':
        'function postImageRequestWrapper(u,b){const c=["STATUS_400_OR_422"];return fetch(u,b)};const x="UNPATCHED_SAMPLE_LITERAL_ALPHA";const y="UNPATCHED_SAMPLE_LITERAL_BETA";'
    })
    expect(message).toBeNull()
  })

  it('passes when the patched dependency is not part of this bundle', () => {
    const root = buildFixture()
    fixtures.push(root)
    const message = runGuard(root, { 'main.js': 'console.log("hello world — nothing vendored here")' })
    expect(message).toBeNull()
  })

  it('does not throw when the workspace has no patches', () => {
    const root = mkdtempSync(join(tmpdir(), 'patched-vendor-empty-'))
    fixtures.push(root)
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    const message = runGuard(root, { 'main.js': 'console.log(1)' })
    expect(message).toBeNull()
  })
})

// Silence the unused-import lint for vi in case the environment strips spies.
void vi
