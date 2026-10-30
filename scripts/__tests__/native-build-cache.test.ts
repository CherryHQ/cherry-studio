import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import { Arch } from 'electron-builder'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as packagingHooks from '../packaging/before-pack'
import { saveTask } from '../release/build-cache'
import { cachedNativeBuild, nativeTask } from '../release/native-build-cache'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'native-cache-'))
  roots.push(root)
  writeFileSync(join(root, 'input.c'), 'int main() { return 0; }')
  return {
    root,
    name: 'fixture-native',
    platform: process.platform,
    arch: process.arch,
    electronVersion: 'fixture-1',
    inputs: ['input.c'],
    outputs: ['helper']
  }
}

describe('native build reuse', () => {
  it.skipIf(process.platform !== 'darwin')(
    'rebuilds the packaged speech helper when only its embedded permission plist changes',
    async () => {
      vi.stubEnv('CHERRY_BUILD_CACHE', '1')
      const { root } = fixture()
      const plist = join(root, 'packages/system-speech/native/Info.plist')
      const executable = join(root, `packages/system-speech/dist/native/darwin-${process.arch}/cherry-system-speech`)
      mkdirSync(dirname(plist), { recursive: true })
      mkdirSync(dirname(executable), { recursive: true })
      const originalPlist = readFileSync('packages/system-speech/native/Info.plist', 'utf8')
      writeFileSync(plist, originalPlist)
      let allowCompile = true
      const compile = () => {
        if (!allowCompile) throw new Error('expected an unchanged helper cache hit')
        return execFileSync('xcrun', [
          'clang',
          join(root, 'input.c'),
          '-Wl,-sectcreate,__TEXT,__info_plist,' + plist,
          '-o',
          executable
        ])
      }
      const hookPath = resolve('scripts/packaging/before-pack.js')
      const requireHook = createRequire(hookPath)
      const hooks = {} as typeof packagingHooks
      const prepared = new Error('speech helper prepared; stop before unrelated packaging')
      runInNewContext(readFileSync(hookPath, 'utf8'), {
        exports: hooks,
        __dirname: join(root, 'scripts/packaging'),
        require: (id: string) =>
          id === '../release/native-build-cache'
            ? {
                cachedNativeBuild: async (options: Parameters<typeof cachedNativeBuild>[0]) => {
                  await cachedNativeBuild(options, compile)
                  throw prepared
                }
              }
            : requireHook(id)
      })
      const prepare = () =>
        expect(hooks.default({ arch: Arch[process.arch], packager: { platform: { name: 'mac' } } })).rejects.toBe(
          prepared
        )
      await prepare()
      const original = readFileSync(executable)
      expect(original.includes(Buffer.from(originalPlist))).toBe(true)
      rmSync(executable)
      allowCompile = false
      await prepare()
      expect(readFileSync(executable)).toEqual(original)
      allowCompile = true
      const updatedPlist = originalPlist.replace('</string>', ' Updated permission description.</string>')
      writeFileSync(plist, updatedPlist)
      await prepare()
      expect(readFileSync(executable).includes(Buffer.from(updatedPlist))).toBe(true)
      expect(readFileSync(executable).includes(Buffer.from(originalPlist))).toBe(false)
    }
  )

  it('does not reuse a Windows output without a verified toolchain', async () => {
    vi.stubEnv('CHERRY_BUILD_CACHE', '1')
    const options = { ...fixture(), platform: 'win32' }
    await cachedNativeBuild(options, () => writeFileSync(join(options.root, 'helper'), 'old'))
    await cachedNativeBuild(options, () => writeFileSync(join(options.root, 'helper'), 'new'))
    expect(readFileSync(join(options.root, 'helper'), 'utf8')).toBe('new')
  })

  it.skipIf(process.platform !== 'darwin')(
    'restores a native executable and rejects wrong architecture or changed ABI/source',
    async () => {
      vi.stubEnv('CHERRY_BUILD_CACHE', '1')
      const options = fixture()
      const executable = join(options.root, 'helper')
      const compile = (arch = options.arch) =>
        execFileSync('xcrun', [
          'clang',
          '-arch',
          arch === 'x64' ? 'x86_64' : arch,
          join(options.root, 'input.c'),
          '-o',
          executable
        ])
      await cachedNativeBuild(options, () => compile())
      const original = readFileSync(executable)
      rmSync(executable)
      await cachedNativeBuild(options, () => {
        throw new Error('expected a verified cache hit')
      })
      expect(readFileSync(executable)).toEqual(original)
      expect(execFileSync(executable).length).toBe(0)
      const originalTask = nativeTask(options)!
      expect(nativeTask({ ...options, electronVersion: 'fixture-2' })!.key).not.toBe(originalTask.key)
      compile(options.arch === 'arm64' ? 'x64' : 'arm64')
      saveTask(originalTask)
      await cachedNativeBuild(options, () => compile())
      expect(execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim()).toBe(
        options.arch === 'x64' ? 'x86_64' : 'arm64'
      )
      writeFileSync(join(options.root, 'input.c'), '#include <stdio.h>\nint main() { puts("changed"); return 0; }')
      await cachedNativeBuild(options, () => compile())
      expect(execFileSync(executable, { encoding: 'utf8' })).toBe('changed\n')
    }
  )
})
