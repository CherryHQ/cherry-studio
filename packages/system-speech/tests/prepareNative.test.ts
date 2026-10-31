import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { prepareNativeHelper } = require('../scripts/prepare-native.cjs')
const directories: string[] = []

function fixture(platform = 'win32', arch = 'x64') {
  const packageRoot = mkdtempSync(join(tmpdir(), 'system-speech-prepare-'))
  directories.push(packageRoot)
  const source = join(
    packageRoot,
    platform === 'win32' ? 'windows/SystemSpeechHelper.cpp' : 'native/Sources/Helper.swift'
  )
  const files = [
    join(packageRoot, 'scripts/build-native.cjs'),
    source,
    join(packageRoot, platform === 'win32' ? 'windows/build.cmd' : 'native/Package.swift')
  ]
  for (const file of files) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'initial source')
    utimesSync(file, 1, 1)
  }
  const helperPath = join(
    packageRoot,
    'dist/native',
    `${platform}-${arch}`,
    platform === 'win32' ? 'cherry-system-speech.exe' : 'cherry-system-speech'
  )
  const build = (targetArch: string, targetPlatform: string) => {
    mkdirSync(dirname(helperPath), { recursive: true })
    writeFileSync(helperPath, `${targetPlatform}-${targetArch}: ${readFileSync(source, 'utf8')}`, { mode: 0o755 })
    return helperPath
  }
  return { platform, arch, packageRoot, source, helperPath, build }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('system-speech-prepare-'))
      throw new Error('Unexpected native speech test directory')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('development native speech preparation', () => {
  it.each([
    ['win32', 'x64'],
    ['darwin', 'arm64']
  ])('builds the missing helper for %s-%s before launching the app', (platform, arch) => {
    const input = fixture(platform, arch)
    expect(prepareNativeHelper(input)).toEqual({ helperPath: input.helperPath, rebuilt: true })
    expect(readFileSync(input.helperPath, 'utf8')).toBe(`${platform}-${arch}: initial source`)
  })

  it('reuses an up-to-date helper without requiring another compiler invocation', () => {
    const input = fixture()
    input.build(input.arch, input.platform)
    const result = prepareNativeHelper({
      ...input,
      build: () => {
        throw new Error('Compiler must not run')
      }
    })
    expect(result).toEqual({ helperPath: input.helperPath, rebuilt: false })
    expect(readFileSync(input.helperPath, 'utf8')).toBe('win32-x64: initial source')
  })

  it('rebuilds after a native source change instead of launching an outdated helper', () => {
    const input = fixture()
    input.build(input.arch, input.platform)
    utimesSync(input.helperPath, 1, 1)
    writeFileSync(input.source, 'updated source')
    expect(prepareNativeHelper(input).rebuilt).toBe(true)
    expect(readFileSync(input.helperPath, 'utf8')).toBe('win32-x64: updated source')
  })

  it.each([
    ['linux', 'x64'],
    ['win32', 'arm64']
  ])('does not block development on unsupported %s-%s hosts', (platform, arch) => {
    expect(
      prepareNativeHelper({
        platform,
        arch,
        packageRoot: '/missing',
        build: () => {
          throw new Error('Unsupported build')
        }
      })
    ).toBeNull()
  })
})
