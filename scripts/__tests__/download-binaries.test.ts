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
import { extract, verifyBundledBinaries } from '../download-binaries'

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
})
