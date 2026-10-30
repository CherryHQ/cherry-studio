import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { build } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import { cacheBypassReason, hasDeclaredInputs, javascriptTask } from '../release/build-app'
import { restoreTask, saveTask } from '../release/build-cache'
import { buildInputGuard } from '../release/buildInputGuard'

const roots: string[] = []
function write(root: string, file: string, content: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), content)
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-inputs-'))
  roots.push(root)
  execFileSync('git', ['init', '-q', root])
  write(root, '.gitignore', 'out/\n.cache/')
  for (const file of [
    'src/main/a.ts',
    'src/renderer/a.ts',
    'src/shared/a.ts',
    'pnpm-lock.yaml',
    'package.json',
    'electron.vite.config.ts',
    'patches/dependency.patch',
    'packages/ui/src/a.ts',
    'electron-builder.yml',
    'resources/cherry-studio/release-history.json'
  ])
    write(root, file, 'original')
  return root
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('release build input boundaries', () => {
  it('does not rebuild renderer for a main-only hotfix and release notes', () => {
    const root = fixture()
    const renderer = javascriptTask(root, 'renderer', {}).key
    const main = javascriptTask(root, 'main', {}).key
    write(root, 'src/main/a.ts', 'hotfix')
    write(root, 'electron-builder.yml', 'new release notes')
    write(root, 'resources/cherry-studio/release-history.json', 'new release notes')
    expect(javascriptTask(root, 'renderer', {}).key).toBe(renderer)
    expect(javascriptTask(root, 'main', {}).key).not.toBe(main)
  })

  it.each([
    'src/shared/a.ts',
    'pnpm-lock.yaml',
    'package.json',
    'electron.vite.config.ts',
    'patches/dependency.patch',
    'packages/ui/src/a.ts',
    'src/renderer/new-import.ts'
  ])('invalidates renderer on %s', (file) => {
    const root = fixture()
    const previous = javascriptTask(root, 'renderer', {}).key
    write(root, file, 'changed')
    expect(javascriptTask(root, 'renderer', {}).key).not.toBe(previous)
  })

  it('refuses to save a bundle that imports an undeclared process', () => {
    const root = fixture()
    write(root, 'out/renderer/.build-inputs.json', JSON.stringify(['src/renderer/a.ts', 'src/main/a.ts']))
    expect(hasDeclaredInputs(root, 'renderer')).toBe(false)
    write(root, 'out/renderer/.build-inputs.json', JSON.stringify(['src/renderer/a.ts', 'src/shared/a.ts']))
    expect(hasDeclaredInputs(root, 'renderer')).toBe(true)
  })

  it('bypasses secret-bearing builds, upload side effects, and local dotenv files', () => {
    const root = fixture()
    expect(cacheBypassReason(root, {})).toBe('disabled')
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1' })).toBeNull()
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1', SENTRY_SOURCE_MAP_UPLOAD: 'true' })).toBe('sentry-upload')
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1', MAIN_VITE_CLIENT_SECRET: 'secret' })).toBe(
      'build-environment'
    )
    write(root, '.env.production', 'MAIN_VITE_CLIENT_SECRET=secret')
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1' })).toBe('dotenv')
  })
  it('restores executable output and rebuilds after adding a new import', async () => {
    const root = fixture()
    write(root, 'package.json', '{}')
    write(root, 'src/renderer/a.ts', 'export const result: string = "first"')
    const compile = () =>
      build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: 'silent',
        plugins: [buildInputGuard(root)],
        build: {
          outDir: join(root, 'out/renderer'),
          lib: { entry: join(root, 'src/renderer/a.ts'), formats: ['es'], fileName: () => 'entry.mjs' }
        }
      })
    const execute = () =>
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { result } from ${JSON.stringify(join(root, 'out/renderer/entry.mjs'))}; process.stdout.write(result)`
        ],
        { encoding: 'utf8' }
      )
    const initial = javascriptTask(root, 'renderer', {})
    await compile()
    expect(hasDeclaredInputs(root, 'renderer')).toBe(true)
    expect(execute()).toBe('first')
    saveTask(initial)
    rmSync(join(root, 'out'), { recursive: true })
    expect(restoreTask(initial)).toBe(true)
    expect(execute()).toBe('first')
    write(root, 'src/renderer/value.ts', 'export const value = "from new import"')
    write(root, 'src/renderer/a.ts', 'export { value as result } from "./value"')
    expect(restoreTask(javascriptTask(root, 'renderer', {}))).toBe(false)
    await compile()
    expect(execute()).toBe('from new import')
  })
})
