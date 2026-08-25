/**
 * Covers download()'s resume/fallback branching, which needs a stubbed curl and
 * therefore its own file — the sibling suite runs real unzip/tar against
 * fixtures.
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// The script is CJS and destructures execFileSync at module load, so the stub
// has to be installed on the shared module object *before* it is first required
// — a later spy would not reach the binding it already captured.
const require = createRequire(import.meta.url)
const execFileSync = vi.spyOn(require('child_process'), 'execFileSync')
const cjsFs = require('fs') as typeof fs
const { download, downloadTool } = require('../download-binaries')

let tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-resume-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs = []
  execFileSync.mockReset()
})

function curlFailure(status: number): Error {
  return Object.assign(new Error(`curl exited ${status}`), { status })
}

/** Stub the next curl invocation, handing `write` the -o destination it was given. */
function stubCurl(write: (dest: string) => void) {
  execFileSync.mockImplementationOnce(((_cmd: string, args: string[]) => {
    write(args[args.indexOf('-o') + 1])
    return ''
  }) as never)
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

describe('download – resume and fallback', () => {
  it('keeps the partial file when the transfer drops, so the next run can resume', () => {
    const dest = path.join(makeTmpDir(), 'rg.14.1.1.part')
    fs.writeFileSync(dest, 'half a download')
    // 18 is curl's transfer-interrupted code — the case resuming exists for.
    execFileSync.mockImplementationOnce(() => {
      throw curlFailure(18)
    })

    expect(() => download('https://example.invalid/rg.tar.gz', dest)).toThrow(/curl exited 18/)
    expect(fs.readFileSync(dest, 'utf8')).toBe('half a download')
    expect(execFileSync).toHaveBeenCalledOnce()
  })

  it('re-downloads without resume when the server refuses the range', () => {
    const dest = path.join(makeTmpDir(), 'rg.14.1.1.part')
    fs.writeFileSync(dest, 'unusable leftover')
    execFileSync.mockImplementationOnce(() => {
      throw curlFailure(33)
    })
    stubCurl((target) => fs.writeFileSync(target, 'complete payload'))

    download('https://example.invalid/rg.tar.gz', dest)

    expect(execFileSync.mock.calls[1][1]).not.toContain('-C')
    expect(fs.readFileSync(dest, 'utf8')).toBe('complete payload')
  })

  it('passes -C - so a fresh run is still resumable', () => {
    const dest = path.join(makeTmpDir(), 'rg.14.1.1.part')
    execFileSync.mockImplementationOnce((() => '') as never)

    download('https://example.invalid/rg.tar.gz', dest)

    expect(execFileSync.mock.calls[0][1]).toContain('-C')
  })
})

describe('downloadTool – packaging over a bundle of hard links', () => {
  const PAYLOAD = 'new binary payload'
  const tool = {
    name: 'faketool',
    version: '2.0.0',
    versionFile: '.fake-version',
    packages: {
      'test-arch': {
        url: 'https://example.invalid/faketool',
        archive: 'none',
        binaries: ['faketool'],
        sha256: '357a1a4e028ef8e3423cc6f9c066e8f85ff3bd3dbee4ea2b8fe3380b5fdff7fb'
      }
    }
  }

  it('does not write through the links a previous dev run left in the bundle', () => {
    const cache = makeTmpDir()
    const bundle = makeTmpDir()
    // What `pnpm dev` leaves behind: the bundle is hard links into the cache.
    fs.writeFileSync(path.join(cache, 'faketool'), 'cached 1.0.0 build')
    fs.linkSync(path.join(cache, 'faketool'), path.join(bundle, 'faketool'))
    fs.writeFileSync(path.join(bundle, '.fake-version'), '1.0.0')
    stubCurl((dest) => fs.writeFileSync(dest, PAYLOAD))

    downloadTool(tool, 'test-arch', bundle, { versionFile: '.fake-version' })

    expect(fs.readFileSync(path.join(bundle, 'faketool'), 'utf8')).toBe(PAYLOAD)
    expect(fs.readFileSync(path.join(bundle, '.fake-version'), 'utf8')).toBe('2.0.0')
    // The shared cache is another worktree's data — packaging must not touch it.
    expect(fs.readFileSync(path.join(cache, 'faketool'), 'utf8')).toBe('cached 1.0.0 build')
  })

  it('keeps the partial file when a run fails, and resumes onto it next time', () => {
    const dir = makeTmpDir()
    stubCurl((dest) => {
      fs.writeFileSync(dest, 'half of the payload')
      throw curlFailure(18)
    })

    expect(() => downloadTool(tool, 'test-arch', dir)).toThrow()

    const partials = listFiles(dir).filter((file) => file.endsWith('.part'))
    // Cleanup must not be in a finally: the bytes are what the next -C - resumes.
    expect(partials).toHaveLength(1)
    expect(fs.readFileSync(partials[0], 'utf8')).toBe('half of the payload')

    // The retry has to reuse that exact path, or the resume is pointless.
    let resumedOnto = ''
    stubCurl((dest) => {
      resumedOnto = dest
      fs.writeFileSync(dest, PAYLOAD)
    })

    downloadTool(tool, 'test-arch', dir)

    expect(resumedOnto).toBe(partials[0])
    expect(fs.readFileSync(path.join(dir, 'faketool'), 'utf8')).toBe(PAYLOAD)
  })

  it('clears retired debris even when the download itself is a cache hit', () => {
    const dir = makeTmpDir()
    fs.writeFileSync(path.join(dir, 'faketool'), PAYLOAD)
    // A previous run died between the two renames of a zip-tree commit. The
    // binary is present, so this run short-circuits — the debris still has to go.
    fs.mkdirSync(path.join(dir, '.retired-4242-git', 'cmd'), { recursive: true })

    downloadTool(tool, 'test-arch', dir)

    expect(fs.readdirSync(dir).filter((e) => e.startsWith('.retired-'))).toEqual([])
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('clears its own staging on a cache hit, so packaging cannot wedge forever', () => {
    const dir = makeTmpDir()
    // Run 1 dies mid-download and keeps its partial on purpose.
    stubCurl((dest) => {
      fs.writeFileSync(dest, 'half of the payload')
      throw curlFailure(18)
    })
    expect(() => downloadTool(tool, 'test-arch', dir)).toThrow()
    // Run 2 committed the binary but died before clearing staging.
    fs.writeFileSync(path.join(dir, 'faketool'), PAYLOAD)

    downloadTool(tool, 'test-arch', dir)

    // Left behind, verifyBundledBinaries rejects the bundle on every later run
    // and the cache hit means no run ever gets far enough to clean it up.
    expect(fs.readdirSync(dir).filter((e) => e.startsWith('.staging-'))).toEqual([])
  })

  it('leaves no staging or retired debris behind on success', () => {
    const dir = makeTmpDir()
    stubCurl((dest) => fs.writeFileSync(dest, PAYLOAD))

    downloadTool(tool, 'test-arch', dir)

    expect(fs.readdirSync(dir).filter((e) => e.startsWith('.staging-') || e.startsWith('.retired-'))).toEqual([])
  })

  it('deletes a corrupt download so a bad resume cannot wedge every future run', () => {
    const dir = makeTmpDir()
    stubCurl((dest) => fs.writeFileSync(dest, 'corrupted bytes'))

    expect(() => downloadTool(tool, 'test-arch', dir)).toThrow(/SHA256 mismatch/)

    // Left in place, curl -C - would append to the bad bytes forever and every
    // run in every worktree would fail with no way out but deleting the cache.
    expect(listFiles(dir)).toEqual([])
  })
})

describe('downloadTool – zip-tree commit (MinGit)', () => {
  const FIXTURE_ZIP = path.join(__dirname, 'fixtures', 'mingit-tree.zip')
  const tool = {
    name: 'mingit',
    version: '2.54.0',
    versionFile: '.mingit-version',
    packages: {
      'test-arch': {
        url: 'https://example.invalid/MinGit.zip',
        archive: 'zip-tree',
        dir: 'git',
        binaries: ['git/cmd/git.txt'],
        sha256: '398b94a38eba838dce6af215c4410d1c14a854f284484962e2852f9aa6c8755a'
      }
    }
  }

  /** A bundle holding an older MinGit, as a packaging run would find it. */
  function seedPreviousTree(dir: string, files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, 'git', rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, 'git', rel), content)
    }
    fs.writeFileSync(path.join(dir, '.mingit-version'), '2.50.0', 'utf8')
  }

  it('replaces the previous tree instead of merging into it', () => {
    const dir = makeTmpDir()
    seedPreviousTree(dir, { 'cmd/git.txt': 'old launcher', 'cmd/dropped.txt': 'from an older release' })
    stubCurl((dest) => fs.copyFileSync(FIXTURE_ZIP, dest))

    downloadTool(tool, 'test-arch', dir, { versionFile: '.mingit-version' })

    expect(fs.readFileSync(path.join(dir, 'git', 'cmd', 'git.txt'), 'utf8')).toBe('fake git launcher\n')
    // Without the retire step the rename fails on the non-empty directory and
    // the old tree survives — labelled with the new version.
    expect(fs.existsSync(path.join(dir, 'git', 'cmd', 'dropped.txt'))).toBe(false)
    expect(fs.readdirSync(dir).filter((e) => e.startsWith('.retired-'))).toEqual([])
  })

  it('restores the previous tree when the commit fails, rather than leaving none', () => {
    const dir = makeTmpDir()
    seedPreviousTree(dir, { 'cmd/git.txt': 'previous working tree' })
    stubCurl((dest) => fs.copyFileSync(FIXTURE_ZIP, dest))
    const realRename = cjsFs.renameSync
    const rename = vi.spyOn(cjsFs, 'renameSync').mockImplementation(((from: string, to: string) => {
      // Fail only the publish — the way Windows reports a tree held open — and
      // let the rollback rename through, which is what the test is about.
      if (from.includes('.staging-')) throw Object.assign(new Error('busy'), { code: 'EPERM' })
      return realRename(from, to)
    }) as never)

    try {
      expect(() => downloadTool(tool, 'test-arch', dir, { versionFile: '.mingit-version' })).toThrow(/busy/)
    } finally {
      rename.mockRestore()
    }

    expect(fs.readFileSync(path.join(dir, 'git', 'cmd', 'git.txt'), 'utf8')).toBe('previous working tree')
  })
})
