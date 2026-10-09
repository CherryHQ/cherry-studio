import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
/**
 * Build-script coverage for download-binaries.js: the `zip-tree` extraction mode
 * (real extraction against a committed fixture, no fs mocking — the platform
 * unzip/Expand-Archive branch actually runs), the shippability rules in
 * verifyBundledBinaries, and the shared-cache linking and reclaim logic.
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

// CJS build script — vitest interops the module.exports fine.
import {
  cachedVersionDir,
  downloadTool,
  extract,
  materialize,
  sweepUnreferencedVersions,
  TOOLS,
  verifyBundledBinaries
} from '../download-binaries'

const FIXTURE_ZIP = path.join(__dirname, 'fixtures', 'mingit-tree.zip')

// The script is CJS and calls require('fs'); that module object is mutable,
// unlike the ESM namespace this file imports, so it is what a spy must target.
const cjsFs = createRequire(import.meta.url)('fs') as typeof fs

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

const LINUX_FFMPEG_TREE: Record<string, string> = {
  'bin/ffmpeg': 'ffmpeg',
  'bin/ffprobe': 'ffprobe',
  'lib/libavcodec.so.61': 'avcodec',
  'lib/libswscale.so.8': 'swscale',
  'licenses/ffmpeg/COPYING.LGPLv2.1': 'LGPL',
  'SOURCE.txt': 'source',
  'manifest.json': '{"tag":"ffmpeg-lgpl-v8.1.2-r1"}',
  'lib/pkgconfig/extra.pc': 'unlisted'
}

function writeRelativeFiles(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
}

function makeStrippedLinuxArchive(files: Record<string, string>): string {
  const parent = makeTmpDir('dl-linux-src-')
  const top = 'ffmpeg-lgpl-v8.1.2-linux-x64'
  writeRelativeFiles(path.join(parent, top), files)
  const archivePath = path.join(makeTmpDir('dl-linux-archive-'), 'ffmpeg.tar.gz')
  execFileSync('tar', ['czf', archivePath, '-C', parent, top])
  return archivePath
}

describe('extract – Linux FFmpeg tar tree', () => {
  const linuxPkg = () =>
    (
      TOOLS.find((tool) => tool.name === 'ffmpeg') as {
        packages: Record<string, { dir: string; stripComponents: number; tree: unknown }>
      }
    ).packages['linux-x64']

  it('keeps the stripped bin, lib, license, source, and manifest tree', () => {
    const outputDir = makeTmpDir('dl-linux-out-')
    const stale = path.join(outputDir, 'ffmpeg', 'lib', 'old.so')
    fs.mkdirSync(path.dirname(stale), { recursive: true })
    fs.writeFileSync(stale, 'stale')

    extract(makeStrippedLinuxArchive(LINUX_FFMPEG_TREE), 'tar.gz', outputDir, linuxPkg())

    const root = path.join(outputDir, 'ffmpeg')
    expect(fs.readFileSync(path.join(root, 'bin', 'ffmpeg'), 'utf8')).toBe('ffmpeg')
    expect(fs.readFileSync(path.join(root, 'bin', 'ffprobe'), 'utf8')).toBe('ffprobe')
    expect(fs.readFileSync(path.join(root, 'lib', 'libavcodec.so.61'), 'utf8')).toBe('avcodec')
    expect(fs.readFileSync(path.join(root, 'lib', 'libswscale.so.8'), 'utf8')).toBe('swscale')
    expect(fs.readFileSync(path.join(root, 'licenses', 'ffmpeg', 'COPYING.LGPLv2.1'), 'utf8')).toBe('LGPL')
    expect(fs.readFileSync(path.join(root, 'SOURCE.txt'), 'utf8')).toBe('source')
    expect(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).toContain('ffmpeg-lgpl-v8.1.2-r1')
    expect(fs.readFileSync(path.join(root, 'lib', 'pkgconfig', 'extra.pc'), 'utf8')).toBe('unlisted')
    expect(fs.existsSync(path.join(outputDir, 'ffmpeg'))).toBe(true)
    expect(fs.existsSync(path.join(outputDir, 'bin'))).toBe(false)
    expect(fs.existsSync(stale)).toBe(false)
  })

  it('rejects a stripped tree with no replaceable libav library', () => {
    const outputDir = makeTmpDir('dl-linux-out-')
    const withoutLibav = { ...LINUX_FFMPEG_TREE }
    delete withoutLibav['lib/libavcodec.so.61']

    expect(() => extract(makeStrippedLinuxArchive(withoutLibav), 'tar.gz', outputDir, linuxPkg())).toThrow(
      /lib\/libav\*\.so\*/
    )
  })
})

describe('extract – flat tar.gz mode', () => {
  it('preserves every declared FFmpeg runtime and license file with stripComponents=0', () => {
    const fixtureDir = makeTmpDir('dl-tar-source-')
    const outputDir = makeTmpDir('dl-tar-output-')
    const archivePath = path.join(makeTmpDir('dl-tar-archive-'), 'ffmpeg.tar.gz')
    const files = ['ffmpeg', 'ffprobe', 'COPYING.LGPLv2.1', 'SOURCE.txt']
    for (const file of files) fs.writeFileSync(path.join(fixtureDir, file), file, 'utf8')
    execFileSync('tar', ['czf', archivePath, '-C', fixtureDir, '.'])

    extract(archivePath, 'tar.gz', outputDir, { binaries: files, stripComponents: 0 })

    expect(
      Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(outputDir, file), 'utf8')]))
    ).toEqual(Object.fromEntries(files.map((file) => [file, file])))
  })

  it('adds a repository-owned license companion that is not present in the archive', () => {
    const fixtureDir = makeTmpDir('dl-tar-source-')
    const outputDir = makeTmpDir('dl-tar-output-')
    const archivePath = path.join(makeTmpDir('dl-tar-archive-'), 'ffmpeg.tar.gz')
    const archiveFiles = ['ffmpeg', 'ffprobe']
    for (const file of archiveFiles) fs.writeFileSync(path.join(fixtureDir, file), file, 'utf8')
    execFileSync('tar', ['czf', archivePath, '-C', fixtureDir, '.'])
    const sha256 = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
    const platformKey = 'win32-x64'
    const exception = 'GCC-RUNTIME-LIBRARY-EXCEPTION.txt'

    downloadTool(
      {
        name: 'ffmpeg-fixture',
        version: '1',
        versionFile: '.ffmpeg-version',
        packages: {
          [platformKey]: {
            url: pathToFileURL(archivePath).toString(),
            archive: 'tar.gz',
            stripComponents: 0,
            binaries: [...archiveFiles, exception],
            archiveFiles,
            localFiles: [{ source: `scripts/packaging/licenses/${exception}`, name: exception }],
            executableFiles: archiveFiles,
            sha256
          }
        }
      },
      platformKey,
      outputDir,
      { versionFile: '.ffmpeg-version' }
    )

    expect(fs.readFileSync(path.join(outputDir, exception), 'utf8')).toContain('GCC RUNTIME LIBRARY EXCEPTION')
    expect(fs.readFileSync(path.join(outputDir, '.ffmpeg-version'), 'utf8')).toBe('1')
  })
})

describe('FFmpeg bundle manifest', () => {
  const ffmpeg = TOOLS.find((tool) => tool.name === 'ffmpeg')!
  const packages = ffmpeg.packages as Record<
    string,
    {
      binaries: string[]
      archiveFiles?: string[]
      localFiles?: Array<{ source: string; name: string }>
      executableFiles: string[]
      url: string
      sha256: string
      dir?: string
      stripComponents?: number
      version?: string
      tree?: {
        executables: string[]
        sharedLibraries: string[]
        notices: string[]
      }
    }
  >

  it('pins a package with license and source notices for every flat target', () => {
    expect(ffmpeg.supportedPlatforms).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'win32-arm64',
      'win32-x64',
      'linux-x64',
      'linux-arm64'
    ])
    expect(Object.keys(packages).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64'
    ])
    for (const [platform, pkg] of Object.entries(packages)) {
      if (platform.startsWith('linux-')) continue
      expect(pkg.binaries).toContain('COPYING.LGPLv2.1')
      expect(pkg.binaries).toContain('SOURCE.txt')
      expect(pkg.executableFiles).toHaveLength(2)
      expect(pkg.dir).toBeUndefined()
    }
  })

  it.each(['x64', 'arm64'] as const)('pins the immutable Linux %s shared tree', (arch) => {
    const pkg = packages[`linux-${arch}`]
    const checksums = {
      x64: '1de031a8774b7b10b2e823be50bbed52be27bf89a46b7cf8b33cc48cfb5143d2',
      arm64: 'e579ec85a8fe6206030e2f0ca1a9b699d3a9db03c7eb1987f5b0aa1083d04f5d'
    }
    expect(pkg.url).toBe(
      `https://github.com/CherryHQ/cherry-studio-ffmpeg-lgpl/releases/download/ffmpeg-lgpl-v8.1.2-r1/ffmpeg-lgpl-v8.1.2-linux-${arch}.tar.gz`
    )
    expect(pkg.sha256).toBe(checksums[arch])
    expect(pkg.stripComponents).toBe(1)
    expect(pkg.dir).toBe('ffmpeg')
    expect(pkg.version).toBe('ffmpeg-lgpl-v8.1.2-r1')
    expect(pkg.executableFiles).toEqual(['ffmpeg/bin/ffmpeg', 'ffmpeg/bin/ffprobe'])
    expect(pkg.tree).toEqual({
      executables: ['bin/ffmpeg', 'bin/ffprobe'],
      sharedLibraries: ['lib/libav*.so*', 'lib/libsw*.so*'],
      notices: ['licenses/**', 'SOURCE.txt', 'manifest.json']
    })
  })

  it('uses the stable x64 Windows artifact and ships its runtime DLLs for arm64 emulation', () => {
    const x64 = packages['win32-x64']
    const arm64 = packages['win32-arm64']
    expect(arm64.url).toBe(x64.url)
    expect(arm64.sha256).toBe(x64.sha256)
    expect(arm64.binaries).toEqual(
      expect.arrayContaining(['libopenh264-7.dll', 'libstdc++-6.dll', 'GCC-RUNTIME-LIBRARY-EXCEPTION.txt'])
    )
    expect(arm64.archiveFiles).not.toContain('GCC-RUNTIME-LIBRARY-EXCEPTION.txt')
    expect(arm64.localFiles).toEqual([
      {
        source: 'scripts/packaging/licenses/GCC-RUNTIME-LIBRARY-EXCEPTION.txt',
        name: 'GCC-RUNTIME-LIBRARY-EXCEPTION.txt'
      }
    ])
  })
})

describe('verifyBundledBinaries – supported platform rule', () => {
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

  /** A shippable bundle for `tool`: every binary plus a matching marker. */
  function makeCompleteBundle(
    platformKey: string,
    tool: { version: string; versionFile: string; packages: Record<string, { binaries: string[] }> }
  ) {
    const resourcesDir = makeResourcesDir(platformKey, tool.packages[platformKey].binaries)
    fs.writeFileSync(path.join(resourcesDir, platformKey, tool.versionFile), tool.version, 'utf8')
    return resourcesDir
  }

  const regularTool = {
    name: 'mise',
    version: '1.0.0',
    versionFile: '.mise-version',
    packages: { 'linux-x64': { binaries: ['mise'] }, 'win32-x64': { binaries: ['mise.exe'] } }
  }
  const windowsOnlyTool = {
    name: 'mingit',
    version: '2.54.0',
    versionFile: '.mingit-version',
    supportedPlatforms: ['win32-x64'],
    packages: { 'win32-x64': { binaries: ['git/cmd/git.exe'] } }
  }

  it('does not flag a tool outside its supported platforms', () => {
    const resourcesDir = makeCompleteBundle('linux-x64', regularTool)

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

  it('still verifies a tool on its supported platform', () => {
    // Package declared for win32-x64 but git.exe missing on disk → must fail.
    const resourcesDir = makeCompleteBundle('win32-x64', regularTool)

    expect(() =>
      verifyBundledBinaries('win32', 'x64', { tools: [regularTool, windowsOnlyTool], resourcesDir })
    ).toThrow(/git[\\/]cmd[\\/]git\.exe/)
  })

  it('rejects a bundle whose version marker is missing, which the app would skip silently', () => {
    const resourcesDir = makeResourcesDir('linux-x64', ['mise'])

    expect(() => verifyBundledBinaries('linux', 'x64', { tools: [regularTool], resourcesDir })).toThrow(
      /\.mise-version.*never extract mise/s
    )
  })

  it('rejects a bundle whose marker disagrees with the version being shipped', () => {
    const resourcesDir = makeCompleteBundle('linux-x64', regularTool)
    fs.writeFileSync(path.join(resourcesDir, 'linux-x64', '.mise-version'), '0.9.0', 'utf8')

    expect(() => verifyBundledBinaries('linux', 'x64', { tools: [regularTool], resourcesDir })).toThrow(
      /says 0\.9\.0, expected 1\.0\.0/
    )
  })

  it('rejects download debris that electron-builder would pack into the app', () => {
    const resourcesDir = makeCompleteBundle('linux-x64', regularTool)
    fs.mkdirSync(path.join(resourcesDir, 'linux-x64', '.staging-deadbeef'), { recursive: true })

    expect(() => verifyBundledBinaries('linux', 'x64', { tools: [regularTool], resourcesDir })).toThrow(
      /\.staging-deadbeef.*would be packaged/s
    )
  })

  it.each(['x64', 'arm64'])('requires mise-shim.exe in the Windows %s release resources', (arch) => {
    const platformKey = `win32-${arch}`
    const resourcesDir = makeResourcesDir(platformKey, ['mise.exe'])

    expect(() => verifyBundledBinaries('win32', arch, { tools: [mise], resourcesDir })).toThrow(/mise-shim\.exe/)
  })
})

const PLATFORM = 'test-arch'

function fakeTool(name: string, version: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    version,
    versionFile: `.${name}-version`,
    packages: { [PLATFORM]: { binaries: [name], ...extra } }
  }
}

/** Populate <cache>/<platform>/<tool>/<version>/ the way downloadTool would. */
function seedCache(cacheRoot: string, tool: ReturnType<typeof fakeTool>, files: Record<string, string>) {
  const dir = cachedVersionDir(cacheRoot, PLATFORM, tool)
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

describe('materialize – assembling the bundle from the shared cache', () => {
  it('hard-links the cached version so the bundle costs no disk', () => {
    const cache = makeTmpDir('dl-cache-')
    const bundle = makeTmpDir('dl-bundle-')
    const rg = fakeTool('rg', '14.1.1')
    const cached = seedCache(cache, rg, { rg: 'binary payload' })

    materialize([rg], PLATFORM, cache, bundle)

    const src = fs.statSync(path.join(cached, 'rg'))
    const dest = fs.statSync(path.join(bundle, 'rg'))
    expect(dest.ino).toBe(src.ino)
    expect(dest.nlink).toBe(2)
    expect(fs.readFileSync(path.join(bundle, '.rg-version'), 'utf8')).toBe('14.1.1')
  })

  it('keeps versions apart, so two worktrees on different versions never collide', () => {
    const cache = makeTmpDir('dl-cache-')
    const oldBundle = makeTmpDir('dl-bundle-')
    const newBundle = makeTmpDir('dl-bundle-')
    const v1 = fakeTool('uv', '0.11.15')
    const v2 = fakeTool('uv', '0.11.16')
    seedCache(cache, v1, { uv: 'old build' })
    seedCache(cache, v2, { uv: 'new build' })

    materialize([v1], PLATFORM, cache, oldBundle)
    materialize([v2], PLATFORM, cache, newBundle)

    // Both survive: the bundles disagree because the cache holds both versions,
    // rather than one worktree overwriting the other's download.
    expect(fs.readFileSync(path.join(oldBundle, 'uv'), 'utf8')).toBe('old build')
    expect(fs.readFileSync(path.join(oldBundle, '.uv-version'), 'utf8')).toBe('0.11.15')
    expect(fs.readFileSync(path.join(newBundle, 'uv'), 'utf8')).toBe('new build')
    expect(fs.readFileSync(path.join(newBundle, '.uv-version'), 'utf8')).toBe('0.11.16')
  })

  it("leaves a failed tool's existing bundle files alone instead of deleting them", () => {
    const cache = makeTmpDir('dl-cache-')
    const bundle = makeTmpDir('dl-bundle-')
    const rg = fakeTool('rg', '14.1.1')
    const bun = fakeTool('bun', '1.3.14')
    seedCache(cache, rg, { rg: 'fresh' })
    // bun is absent from the cache — its download failed this run.
    fs.writeFileSync(path.join(bundle, 'bun'), 'working binary from an earlier run')
    fs.writeFileSync(path.join(bundle, '.bun-version'), '1.3.14')

    materialize([rg, bun], PLATFORM, cache, bundle)

    expect(fs.readFileSync(path.join(bundle, 'bun'), 'utf8')).toBe('working binary from an earlier run')
    expect(fs.existsSync(path.join(bundle, '.bun-version'))).toBe(true)
  })

  it('materializes the Linux FFmpeg tree and publishes the LGPL tag', () => {
    const cache = makeTmpDir('dl-cache-')
    const bundle = makeTmpDir('dl-bundle-')
    const tool = {
      name: 'ffmpeg',
      version: '8.1.2-27',
      versionFile: '.ffmpeg-version',
      packages: {
        'linux-x64': {
          dir: 'ffmpeg',
          version: 'ffmpeg-lgpl-v8.1.2-r1',
          binaries: ['ffmpeg/bin/ffmpeg', 'ffmpeg/bin/ffprobe'],
          executableFiles: ['ffmpeg/bin/ffmpeg', 'ffmpeg/bin/ffprobe']
        }
      }
    }
    const versionDir = cachedVersionDir(cache, 'linux-x64', tool)
    writeRelativeFiles(path.join(versionDir, 'ffmpeg'), LINUX_FFMPEG_TREE)
    fs.mkdirSync(path.join(bundle, 'ffmpeg', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(bundle, 'ffmpeg', 'bin', 'dropped'), 'from an older version')

    materialize([tool], 'linux-x64', cache, bundle)

    expect(fs.readFileSync(path.join(bundle, '.ffmpeg-version'), 'utf8')).toBe('ffmpeg-lgpl-v8.1.2-r1')
    expect(fs.readFileSync(path.join(bundle, 'ffmpeg', 'lib', 'libavcodec.so.61'), 'utf8')).toBe('avcodec')
    expect(fs.readFileSync(path.join(bundle, 'ffmpeg', 'licenses', 'ffmpeg', 'COPYING.LGPLv2.1'), 'utf8')).toBe('LGPL')
    expect(fs.readFileSync(path.join(bundle, 'ffmpeg', 'manifest.json'), 'utf8')).toContain('ffmpeg-lgpl-v8.1.2-r1')
    expect(fs.existsSync(path.join(bundle, 'ffmpeg', 'bin', 'dropped'))).toBe(false)
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(bundle, 'ffmpeg', 'bin', 'ffmpeg')).mode & 0o111).not.toBe(0)
      expect(fs.statSync(path.join(bundle, 'ffmpeg', 'bin', 'ffprobe')).mode & 0o111).not.toBe(0)
    }
  })

  it('mirrors a whole tree and drops files a shrinking release removed', () => {
    const cache = makeTmpDir('dl-cache-')
    const bundle = makeTmpDir('dl-bundle-')
    const mingit = fakeTool('mingit', '2.54.0', { dir: 'git', binaries: ['git/cmd/git.exe'] })
    seedCache(cache, mingit, { 'git/cmd/git.exe': 'launcher', 'git/mingw64/bin/tool.exe': 'payload' })
    fs.mkdirSync(path.join(bundle, 'git', 'cmd'), { recursive: true })
    fs.writeFileSync(path.join(bundle, 'git', 'cmd', 'dropped.exe'), 'from an older version')

    materialize([mingit], PLATFORM, cache, bundle)

    expect(fs.readFileSync(path.join(bundle, 'git', 'mingw64', 'bin', 'tool.exe'), 'utf8')).toBe('payload')
    expect(fs.existsSync(path.join(bundle, 'git', 'cmd', 'dropped.exe'))).toBe(false)
  })

  it('falls back to a real copy when hard-linking is unavailable, and settles down after', () => {
    const cache = makeTmpDir('dl-cache-')
    const bundle = makeTmpDir('dl-bundle-')
    const rg = fakeTool('rg', '14.1.1')
    seedCache(cache, rg, { rg: 'payload' })
    const linkSync = vi.spyOn(cjsFs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
    })

    try {
      materialize([rg], PLATFORM, cache, bundle)
      const firstIno = fs.statSync(path.join(bundle, 'rg')).ino
      // A copied bundle can never match inodes, so without a second check every
      // run would re-copy the whole bundle.
      const second = materialize([rg], PLATFORM, cache, bundle)

      expect(fs.readFileSync(path.join(bundle, 'rg'), 'utf8')).toBe('payload')
      expect(fs.statSync(path.join(bundle, 'rg')).ino).toBe(firstIno)
      expect(second.copied).toBe(0)
    } finally {
      linkSync.mockRestore()
    }
  })
})

describe('sweepUnreferencedVersions – reclaiming the shared cache', () => {
  const AGE = 24 * 60 * 60 * 1000

  function age(dir: string, ms: number) {
    const when = new Date(Date.now() - ms)
    fs.utimesSync(dir, when, when)
  }

  it('reclaims a version no worktree links to any more', () => {
    const cache = makeTmpDir('dl-cache-')
    const stale = fakeTool('uv', '0.11.15')
    const dir = seedCache(cache, stale, { uv: 'abandoned build' })
    age(dir, 2 * AGE)

    expect(sweepUnreferencedVersions(cache, AGE)).toBe(1)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('never reclaims a version a worktree still links to', () => {
    const cache = makeTmpDir('dl-cache-')
    const bundle = makeTmpDir('dl-bundle-')
    const inUse = fakeTool('uv', '0.11.16')
    const dir = seedCache(cache, inUse, { uv: 'live build' })
    materialize([inUse], PLATFORM, cache, bundle)
    age(dir, 2 * AGE)

    // The hard link from the bundle is the reference count.
    expect(sweepUnreferencedVersions(cache, AGE)).toBe(0)
    expect(fs.readFileSync(path.join(dir, 'uv'), 'utf8')).toBe('live build')
  })

  it('reclaims a platform this machine never builds', () => {
    const cache = makeTmpDir('dl-cache-')
    const foreign = path.join(cache, 'darwin-arm64', 'mise', '2026.7.14')
    fs.mkdirSync(foreign, { recursive: true })
    fs.writeFileSync(path.join(foreign, 'mise'), 'a build for another platform')
    const local = seedCache(cache, fakeTool('mise', '2026.7.14'), { mise: 'this machine' })
    ;[foreign, local].forEach((dir) => {
      const when = new Date(Date.now() - 2 * AGE)
      fs.utimesSync(dir, when, when)
    })

    expect(sweepUnreferencedVersions(cache, AGE)).toBe(2)
    // The whole platform tree goes, not just the versions inside it.
    expect(fs.existsSync(path.join(cache, 'darwin-arm64'))).toBe(false)
  })

  it('finishes the walk when a concurrent sweep deletes a version under it', () => {
    const cache = makeTmpDir('dl-cache-')
    const stale = seedCache(cache, fakeTool('uv', '0.11.15'), { uv: 'abandoned' })
    const racing = seedCache(cache, fakeTool('uv', '0.11.16'), { uv: 'also abandoned' })
    ;[stale, racing].forEach((dir) => age(dir, 2 * AGE))
    // The other worktree wins the race for 0.11.16 between listing and stat'ing it.
    const realReaddir = cjsFs.readdirSync
    const readdirSync = vi.spyOn(cjsFs, 'readdirSync').mockImplementation(((dir: string, options: never) => {
      const entries = realReaddir(dir, options)
      if (path.basename(dir) === 'uv') cjsFs.rmSync(racing, { recursive: true, force: true })
      return entries
    }) as never)

    try {
      // Throwing here would fail a run whose bundle is already complete.
      expect(sweepUnreferencedVersions(cache, AGE)).toBe(1)
    } finally {
      readdirSync.mockRestore()
    }
    expect(fs.existsSync(stale)).toBe(false)
  })

  it('keeps a recently used version even with no links, for copy-based bundles', () => {
    const cache = makeTmpDir('dl-cache-')
    const recent = fakeTool('uv', '0.11.16')
    const dir = seedCache(cache, recent, { uv: 'just downloaded' })

    expect(sweepUnreferencedVersions(cache, AGE)).toBe(0)
    expect(fs.existsSync(dir)).toBe(true)
  })
})
