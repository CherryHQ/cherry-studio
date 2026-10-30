import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
