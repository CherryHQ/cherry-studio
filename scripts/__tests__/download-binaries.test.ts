/**
 * Build-script coverage for the MinGit additions to download-binaries.js:
 * the `zip-tree` extraction mode (real extraction against a committed fixture,
 * no fs mocking — the platform unzip/Expand-Archive branch actually runs) and
 * the `isWindowsOnly` skip rule in verifyBundledArtifacts.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

// CJS build script — vitest interops the module.exports fine.
import {
  bundleFilesArtifact,
  bundleTreeArtifact,
  extract,
  TOOLS,
  verifyBundledArtifacts,
  writeManifest
} from '../download-binaries'

const FIXTURE_ZIP = path.join(__dirname, 'fixtures', 'mingit-tree.zip')
type FilesArtifact = Awaited<ReturnType<typeof bundleFilesArtifact>>
type TreeArtifact = Awaited<ReturnType<typeof bundleTreeArtifact>>
type TestManifest = {
  schemaVersion: number
  platform: string
  arch: string
  artifacts: Record<string, FilesArtifact | TreeArtifact>
}

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

describe('compressed artifact contract', () => {
  const mise = TOOLS.find((tool) => tool.name === 'mise')!
  const supportedPlatformKeys = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']

  function makeResourcesDir(platformKey: string): { outputDir: string; resourcesDir: string } {
    const resourcesDir = makeTmpDir('dl-verify-')
    const outputDir = path.join(resourcesDir, platformKey)
    fs.mkdirSync(outputDir, { recursive: true })
    return { outputDir, resourcesDir }
  }

  async function addFilesArtifact(
    outputDir: string,
    manifest: TestManifest,
    name: string,
    version: string,
    outputs: string[]
  ): Promise<FilesArtifact> {
    const sourceDir = makeTmpDir(`dl-source-${name}-`)
    const files = outputs.map((output) => {
      const source = path.join(sourceDir, output)
      fs.mkdirSync(path.dirname(source), { recursive: true })
      fs.writeFileSync(source, `${name}:${output}\n`, 'utf8')
      return { source, output, archive: `${output}.zst` }
    })
    const artifact = await bundleFilesArtifact({ version, files, outputDir })
    manifest.artifacts[name] = artifact
    return artifact
  }

  const regularTool = {
    name: 'mise',
    version: '1.0.0',
    packages: { 'linux-x64': { binaries: ['mise'] }, 'win32-x64': { binaries: ['mise.exe'] } }
  }
  const windowsOnlyTool = {
    name: 'mingit',
    version: '1.0.0',
    isWindowsOnly: true,
    packages: { 'win32-x64': { archive: 'zip-tree', dir: 'git', binaries: ['git/cmd/git.exe'] } }
  }

  it('round-trips file payloads and verifies their compressed checksum', async () => {
    const { outputDir, resourcesDir } = makeResourcesDir('linux-x64')
    const manifest: TestManifest = { schemaVersion: 1, platform: 'linux', arch: 'x64', artifacts: {} }
    const sourceDir = makeTmpDir('dl-large-source-')
    const source = path.join(sourceDir, 'mise')
    const payload = Buffer.alloc(1024 * 1024, 0x5a)
    fs.writeFileSync(source, payload)
    const artifact = await bundleFilesArtifact({
      version: '1.0.0',
      files: [{ source, output: 'mise', archive: 'mise.zst' }],
      outputDir
    })
    manifest.artifacts.mise = artifact
    writeManifest(outputDir, manifest)

    const archive = path.join(outputDir, artifact.files[0].archive)
    expect(zstdDecompressSync(fs.readFileSync(archive))).toEqual(payload)
    await expect(
      verifyBundledArtifacts('linux', 'x64', { tools: [regularTool, windowsOnlyTool], resourcesDir })
    ).resolves.toBeUndefined()
  })

  it('rejects a compressed payload changed after manifest generation', async () => {
    const { outputDir, resourcesDir } = makeResourcesDir('linux-x64')
    const manifest: TestManifest = { schemaVersion: 1, platform: 'linux', arch: 'x64', artifacts: {} }
    const artifact = await addFilesArtifact(outputDir, manifest, 'mise', '1.0.0', ['mise'])
    writeManifest(outputDir, manifest)
    fs.appendFileSync(path.join(outputDir, artifact.files[0].archive), 'corrupt')

    await expect(verifyBundledArtifacts('linux', 'x64', { tools: [regularTool], resourcesDir })).rejects.toThrow(
      /checksum mismatch/
    )
  })

  it('creates a tar.zst tree whose manifest names the required entrypoint', async () => {
    const { outputDir } = makeResourcesDir('win32-x64')
    const rootDir = path.join(outputDir, 'git')
    fs.mkdirSync(path.join(rootDir, 'cmd'), { recursive: true })
    fs.mkdirSync(path.join(rootDir, 'mingw64', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(rootDir, 'cmd', 'git.exe'), 'git', 'utf8')
    fs.writeFileSync(path.join(rootDir, 'mingw64', 'bin', 'runtime.dll'), 'runtime', 'utf8')

    const artifact = await bundleTreeArtifact({
      version: '1.0.0',
      rootDir,
      archive: 'mingit.tar.zst',
      entrypoints: ['git/cmd/git.exe'],
      outputDir
    })

    expect(artifact).toMatchObject({ kind: 'tree', version: '1.0.0', entrypoints: ['git/cmd/git.exe'] })
    expect(artifact.files.map((file) => file.path)).toEqual(['git/cmd/git.exe', 'git/mingw64/bin/runtime.dll'])
    expect(artifact.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'git/cmd/git.exe', size: 3, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
        expect.objectContaining({
          path: 'git/mingw64/bin/runtime.dll',
          size: 7,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      ])
    )
    expect(zstdDecompressSync(fs.readFileSync(path.join(outputDir, artifact.archive))).length).toBe(artifact.size)
  })

  it('does not require a Windows-only artifact on Linux', async () => {
    const { outputDir, resourcesDir } = makeResourcesDir('linux-x64')
    const manifest: TestManifest = { schemaVersion: 1, platform: 'linux', arch: 'x64', artifacts: {} }
    await addFilesArtifact(outputDir, manifest, 'mise', '1.0.0', ['mise'])
    writeManifest(outputDir, manifest)

    await expect(
      verifyBundledArtifacts('linux', 'x64', { tools: [regularTool, windowsOnlyTool], resourcesDir })
    ).resolves.toBeUndefined()
  })

  it('still rejects a regular tool with no package for the platform', async () => {
    const { outputDir, resourcesDir } = makeResourcesDir('linux-arm64')
    writeManifest(outputDir, { schemaVersion: 1, platform: 'linux', arch: 'arm64', artifacts: {} })

    await expect(verifyBundledArtifacts('linux', 'arm64', { tools: [regularTool], resourcesDir })).rejects.toThrow(
      /mise \(no package for linux-arm64\)/
    )
  })

  it('still requires the MinGit tree on Windows targets', async () => {
    const { outputDir, resourcesDir } = makeResourcesDir('win32-x64')
    const manifest: TestManifest = { schemaVersion: 1, platform: 'win32', arch: 'x64', artifacts: {} }
    await addFilesArtifact(outputDir, manifest, 'mise', '1.0.0', ['mise.exe'])
    writeManifest(outputDir, manifest)

    await expect(
      verifyBundledArtifacts('win32', 'x64', { tools: [regularTool, windowsOnlyTool], resourcesDir })
    ).rejects.toThrow(/mingit \(missing or stale compressed payload/)
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

  it.each(['x64', 'arm64'])('requires mise-shim.exe in the Windows %s release definition', (arch) => {
    const platformKey = `win32-${arch}`

    expect(mise.packages[platformKey]).toMatchObject({
      archive: 'zip',
      binaries: ['mise.exe', 'mise-shim.exe'],
      strip: 'mise/bin'
    })
  })

  it.each(supportedPlatformKeys)('defines every required tool for %s', (platformKey) => {
    for (const tool of TOOLS) {
      if (tool.isWindowsOnly && !platformKey.startsWith('win32-')) continue
      expect(tool.packages[platformKey], `${tool.name} missing ${platformKey}`).toMatchObject({
        archive: expect.any(String),
        binaries: expect.arrayContaining([expect.any(String)]),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        url: expect.stringMatching(/^https:\/\//)
      })
    }
  })
})
