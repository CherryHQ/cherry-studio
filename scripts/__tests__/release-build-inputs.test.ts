import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheBypassReason, hasDeclaredInputs, javascriptTask, taskEnvironment } from '../release/build-app'
import { restoreTask, saveTask } from '../release/build-cache'
import { buildInputGuard } from '../release/buildInputGuard'

const roots: string[] = []
beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/(^|_)VITE_/.test(key)) vi.stubEnv(key, undefined)
  }
})
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
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  vi.unstubAllEnvs()
})

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

  it.each([
    ['version', 'v0.0.0'],
    ['platform', process.platform === 'win32' ? 'darwin' : 'win32'],
    ['arch', process.arch === 'arm64' ? 'x64' : 'arm64']
  ] as const)('rejects cached JS when runtime %s changes', (property, value) => {
    const root = fixture()
    const initial = javascriptTask(root, 'renderer', {})
    write(root, 'out/renderer/entry.js', 'module.exports = "original"')
    saveTask(initial)
    rmSync(join(root, 'out'), { recursive: true })
    const descriptor = Object.getOwnPropertyDescriptor(process, property)!
    let changed
    try {
      Object.defineProperty(process, property, { ...descriptor, value })
      changed = javascriptTask(root, 'renderer', {})
    } finally {
      Object.defineProperty(process, property, descriptor)
    }
    expect(restoreTask(changed)).toBe(false)
  })

  it('refuses to save a bundle that imports an undeclared process', () => {
    const root = fixture()
    write(root, 'out/renderer/.build-inputs.json', JSON.stringify(['src/renderer/a.ts', 'src/main/a.ts']))
    expect(hasDeclaredInputs(root, 'renderer')).toBe(false)
    write(root, 'out/renderer/.build-inputs.json', JSON.stringify(['src/renderer/a.ts', 'src/shared/a.ts']))
    expect(hasDeclaredInputs(root, 'renderer')).toBe(true)
  })

  it('requires encryption for injected values, Sentry maps and local dotenv files', () => {
    const root = fixture()
    expect(cacheBypassReason(root, {})).toBe('disabled')
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1' })).toBeNull()
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1', SENTRY_SOURCE_MAP_UPLOAD: 'true' })).toBe(
      'encryption-key-required'
    )
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1', MAIN_VITE_CLIENT_SECRET: 'secret' })).toBe(
      'encryption-key-required'
    )
    write(root, '.env.production', 'MAIN_VITE_CLIENT_SECRET=secret')
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1' })).toBe('dotenv')
    expect(cacheBypassReason(root, { CHERRY_BUILD_CACHE: '1', CHERRY_BUILD_CACHE_KEY: 'a'.repeat(64) })).toBeNull()
  })

  it('invalidates only the relevant task for effective configuration and excludes upload credentials', () => {
    const root = fixture()
    const env = { CHERRY_BUILD_CACHE_KEY: 'a'.repeat(64), MAIN_VITE_CLIENT_SECRET: 'first' }
    const main = javascriptTask(root, 'main', env)
    const renderer = javascriptTask(root, 'renderer', env)
    const changed = { ...env, MAIN_VITE_CLIENT_SECRET: 'rotated' }
    expect(javascriptTask(root, 'main', changed).key).not.toBe(main.key)
    expect(javascriptTask(root, 'renderer', changed).key).toBe(renderer.key)
    expect(javascriptTask(root, 'main', { ...env, SENTRY_AUTH_TOKEN: 'new-upload-token' }).key).toBe(main.key)
    expect(javascriptTask(root, 'main', { ...env, SENTRY_SOURCE_MAP_UPLOAD: 'true' }).key).not.toBe(main.key)
    expect(javascriptTask(root, 'main', { ...env, CHERRY_BUILD_CACHE_KEY: 'b'.repeat(64) }).key).not.toBe(main.key)
    expect(JSON.stringify(main)).not.toContain('first')
    expect(JSON.stringify(main)).not.toContain(env.CHERRY_BUILD_CACHE_KEY)
    expect(main.cacheRoot).toBe(join(root, '.cache/release-build-encrypted'))
  })

  it('uses Vite dotenv precedence, expansion and process overrides for cache invalidation', () => {
    const root = fixture()
    const env = { CHERRY_BUILD_CACHE_KEY: 'a'.repeat(64) }
    write(root, '.env', 'HOST=base\nRENDERER_VITE_URL=https://${HOST}')
    write(root, '.env.production', 'HOST=production')
    expect(taskEnvironment(root, 'renderer', env)).toEqual({ RENDERER_VITE_URL: 'https://production' })
    const initial = javascriptTask(root, 'renderer', env)
    write(root, '.env.production.local', 'HOST=local')
    expect(taskEnvironment(root, 'renderer', env)).toEqual({ RENDERER_VITE_URL: 'https://local' })
    expect(javascriptTask(root, 'renderer', env).key).not.toBe(initial.key)
    vi.stubEnv('RENDERER_VITE_URL', 'https://override')
    expect(taskEnvironment(root, 'renderer', process.env)).toEqual({ RENDERER_VITE_URL: 'https://override' })
  })
  it('restores executable output across runner image labels and rebuilds after adding a new import', async () => {
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
    const initial = javascriptTask(root, 'renderer', { ImageVersion: '20261021.0445.8' })
    await compile()
    expect(hasDeclaredInputs(root, 'renderer')).toBe(true)
    expect(execute()).toBe('first')
    saveTask(initial)
    rmSync(join(root, 'out'), { recursive: true })
    expect(restoreTask(javascriptTask(root, 'renderer', { ImageVersion: '20261026.0455.2' }))).toBe(true)
    expect(execute()).toBe('first')
    write(root, 'src/renderer/value.ts', 'export const value = "from new import"')
    write(root, 'src/renderer/a.ts', 'export { value as result } from "./value"')
    expect(restoreTask(javascriptTask(root, 'renderer', {}))).toBe(false)
    await compile()
    expect(execute()).toBe('from new import')
  })
})
