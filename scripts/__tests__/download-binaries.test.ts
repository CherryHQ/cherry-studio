/**
 * Build-script coverage for the MinGit additions to download-binaries.js:
 * the `zip-tree` extraction mode (real extraction against a committed fixture,
 * no fs mocking — the platform unzip/Expand-Archive branch actually runs) and
 * the `isWindowsOnly` skip rule in verifyBundledBinaries.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

// CJS build script — vitest interops the module.exports fine.
import { extract, TOOLS, verifyBundledBinaries } from '../download-binaries'

const FIXTURE_ZIP = path.join(__dirname, 'fixtures', 'mingit-tree.zip')

let tmpDirs: string[] = []
function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs = []
})

describe('extract – zip-tree mode', () => {
  it('extracts the full directory tree under pkg.dir', () => {
    const outputDir = makeTmpDir('dl-zip-tree-')

    extract(FIXTURE_ZIP, 'zip-tree', outputDir, { dir: 'git' })

    // Whole tree preserved, not just listed binaries.
    expect(fs.readFileSync(path.join(outputDir, 'git', 'cmd', 'git.txt'), 'utf8')).toBe('fake git launcher\n')
    expect(fs.readFileSync(path.join(outputDir, 'git', 'mingw64', 'bin', 'tool.txt'), 'utf8')).toBe(
      'fake mingw payload\n'
    )
  })

  it('wipes a stale tree before extracting so old-version files cannot linger', () => {
    const outputDir = makeTmpDir('dl-zip-tree-stale-')
    const staleFile = path.join(outputDir, 'git', 'cmd', 'stale-from-old-version.txt')
    fs.mkdirSync(path.dirname(staleFile), { recursive: true })
    fs.writeFileSync(staleFile, 'leftover', 'utf8')

    extract(FIXTURE_ZIP, 'zip-tree', outputDir, { dir: 'git' })

    expect(fs.existsSync(staleFile)).toBe(false)
    expect(fs.existsSync(path.join(outputDir, 'git', 'cmd', 'git.txt'))).toBe(true)
  })
})

describe('verifyBundledBinaries – isWindowsOnly skip rule', () => {
  const mise = TOOLS.find((tool) => tool.name === 'mise')!

  /** A resources dir with the given files pre-created under <platformKey>/. */
  function makeResourcesDir(platformKey: string, files: string[]): string {
    const resourcesDir = makeTmpDir('dl-verify-')
    for (const file of files) {
      const abs = path.join(resourcesDir, platformKey, file)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, '', 'utf8')
    }
    return resourcesDir
  }

  const regularTool = {
    name: 'mise',
    packages: { 'linux-x64': { binaries: ['mise'] }, 'win32-x64': { binaries: ['mise.exe'] } }
  }
  const windowsOnlyTool = {
    name: 'mingit',
    isWindowsOnly: true,
    packages: { 'win32-x64': { binaries: ['git/cmd/git.exe'] } }
  }

  it('does not flag an isWindowsOnly tool that has no package on a non-Windows platform', () => {
    const resourcesDir = makeResourcesDir('linux-x64', ['mise'])

    expect(() =>
      verifyBundledBinaries('linux', 'x64', { tools: [regularTool, windowsOnlyTool], resourcesDir })
    ).not.toThrow()
  })

  it('still flags a regular tool that has no package for the platform', () => {
    const resourcesDir = makeResourcesDir('linux-arm64', [])

    expect(() => verifyBundledBinaries('linux', 'arm64', { tools: [regularTool], resourcesDir })).toThrow(
      /mise \(no package for linux-arm64\)/
    )
  })

  it('still verifies the isWindowsOnly tool binaries on Windows targets', () => {
    // Package declared for win32-x64 but git.exe missing on disk → must fail.
    const resourcesDir = makeResourcesDir('win32-x64', ['mise.exe'])

    expect(() =>
      verifyBundledBinaries('win32', 'x64', { tools: [regularTool, windowsOnlyTool], resourcesDir })
    ).toThrow(/git[\\/]cmd[\\/]git\.exe/)
  })

  it.each([
    ['darwin-arm64', 'mise-v2026.7.14-macos-arm64', '082262daa1cd73e22f71272c574afda560c4fcf39852bc18884eae9e13cd5f2c'],
    ['darwin-x64', 'mise-v2026.7.14-macos-x64', '3a3cf40fd034f83bd5cdffd4d673d40b04a79d06affbd30e5fcc4f00ae0ac460'],
    ['linux-x64', 'mise-v2026.7.14-linux-x64', 'fc96308f4fa085d7359892ac6351ededb35ecfabf1ddc34f5757bc755a2af8a6'],
    ['linux-arm64', 'mise-v2026.7.14-linux-arm64', '94a01dd78c22819aa38f9ef6c0780f48d5160b7f1f557407d6d486667296be6d'],
    [
      'win32-x64',
      'mise-v2026.7.14-windows-x64.zip',
      'fdf01891877650bd0f30ff99e493d88f72423b280867ca44062ee2cecd75c78c'
    ],
    [
      'win32-arm64',
      'mise-v2026.7.14-windows-arm64.zip',
      '10627ebedc1e0a53fe669b9e93b1701975f0cba1165759bc270796a0de37b691'
    ]
  ])('pins mise v2026.7.14 %s asset and checksum', (platformKey, asset, sha256) => {
    expect(mise.version).toBe('2026.7.14')
    expect(mise.packages[platformKey]).toMatchObject({
      url: expect.stringContaining(asset),
      sha256
    })
  })

  it.each(['x64', 'arm64'])('requires mise-shim.exe in the Windows %s release resources', (arch) => {
    const platformKey = `win32-${arch}`
    const resourcesDir = makeResourcesDir(platformKey, ['mise.exe'])

    expect(mise.packages[platformKey]).toMatchObject({
      archive: 'zip',
      binaries: ['mise.exe', 'mise-shim.exe'],
      strip: 'mise/bin'
    })
    expect(() => verifyBundledBinaries('win32', arch, { tools: [mise], resourcesDir })).toThrow(/mise-shim\.exe/)
  })
})
