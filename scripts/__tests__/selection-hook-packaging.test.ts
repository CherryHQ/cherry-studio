import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { verifyPackagedSelectionHook } from '../after-pack'

const temporaryDirectories: string[] = []

function makeAddon(arch: 'x64' | 'arm64'): Buffer {
  const header = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(header)
  header[4] = 2
  header[5] = 1
  header.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18)
  return header
}

function makePackage(targetArch: 'x64' | 'arm64', actualArch = targetArch) {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-package-'))
  temporaryDirectories.push(appOutDir)
  const moduleDir = path.join(appOutDir, 'resources/app.asar.unpacked/node_modules/selection-hook')
  const prebuild = path.join(moduleDir, `prebuilds/linux-${targetArch}/selection-hook.node`)
  fs.mkdirSync(path.dirname(prebuild), { recursive: true })
  fs.writeFileSync(prebuild, makeAddon(actualArch))
  return { appOutDir, moduleDir, prebuild }
}

afterEach(() => {
  for (const dir of temporaryDirectories) fs.rmSync(dir, { recursive: true, force: true })
  temporaryDirectories.length = 0
})

describe('packaged Linux selection-hook', () => {
  it('ships upstream prebuilds without a competing local build', () => {
    const config = parse(fs.readFileSync('electron-builder.yml', 'utf8')) as {
      files: string[]
      asarUnpack: string[]
    }
    expect(config.files).toContain('!node_modules/selection-hook/build/**')
    expect(config.files).not.toContain('!node_modules/selection-hook/prebuilds/**/*')
    expect(config.asarUnpack).toContain('node_modules/selection-hook/prebuilds/**')
  })

  it.each(['x64', 'arm64'] as const)('loads its %s prebuild when no host build shadows it', (arch) => {
    const { appOutDir, prebuild } = makePackage(arch)
    expect(verifyPackagedSelectionHook(appOutDir, arch)).toBe(prebuild)
  })

  it('rejects the host x64 binary in an arm64 package', () => {
    const { appOutDir } = makePackage('arm64', 'x64')
    expect(() => verifyPackagedSelectionHook(appOutDir, 'arm64')).toThrow(/expected arm64.*found x64/i)
  })

  it('rejects a rebuilt host binary that node-gyp-build would select first', () => {
    const { appOutDir, moduleDir } = makePackage('arm64')
    const releaseDir = path.join(moduleDir, 'build/Release')
    fs.mkdirSync(releaseDir, { recursive: true })
    fs.writeFileSync(path.join(releaseDir, 'selection-hook.node'), makeAddon('x64'))
    expect(() => verifyPackagedSelectionHook(appOutDir, 'arm64')).toThrow(/shadows.*prebuild/i)
  })

  it('fails when the arm64 prebuild is missing from the package', () => {
    const { appOutDir, prebuild } = makePackage('arm64')
    fs.unlinkSync(prebuild)
    expect(() => verifyPackagedSelectionHook(appOutDir, 'arm64')).toThrow(/missing.*prebuild/i)
  })
})
