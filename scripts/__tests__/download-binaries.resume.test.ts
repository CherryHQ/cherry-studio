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
    execFileSync
      .mockImplementationOnce(() => {
        throw curlFailure(33)
      })
      .mockImplementationOnce(((_cmd: string, args: string[]) => {
        expect(args).not.toContain('-C')
        fs.writeFileSync(dest, 'complete payload')
        return ''
      }) as never)

    download('https://example.invalid/rg.tar.gz', dest)

    expect(fs.readFileSync(dest, 'utf8')).toBe('complete payload')
  })

  it('passes -C - so a fresh run is still resumable', () => {
    const dest = path.join(makeTmpDir(), 'rg.14.1.1.part')
    execFileSync.mockImplementationOnce((() => '') as never)

    download('https://example.invalid/rg.tar.gz', dest)

    expect(execFileSync.mock.calls[0][1]).toContain('-C')
  })
})

describe('downloadTool – publishing to a hard-linked cache', () => {
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

  it('does not let a version bump reach a worktree whose binary is still old', () => {
    const cache = makeTmpDir()
    const worktree = makeTmpDir()
    // The state materialize() leaves behind: cache and worktree share inodes.
    fs.writeFileSync(path.join(cache, 'faketool'), 'old binary payload')
    fs.writeFileSync(path.join(cache, '.fake-version'), '1.0.0')
    fs.linkSync(path.join(cache, 'faketool'), path.join(worktree, 'faketool'))
    fs.linkSync(path.join(cache, '.fake-version'), path.join(worktree, '.fake-version'))
    execFileSync.mockImplementationOnce(((_cmd: string, args: string[]) => {
      fs.writeFileSync(args[args.indexOf('-o') + 1], PAYLOAD)
      return ''
    }) as never)

    downloadTool(tool, 'test-arch', cache)

    expect(fs.readFileSync(path.join(cache, '.fake-version'), 'utf8')).toBe('2.0.0')
    // The worktree still holds the old binary, so it must still read as 1.0.0 —
    // an in-place marker write would pierce the link and label old bytes new.
    expect(fs.readFileSync(path.join(worktree, 'faketool'), 'utf8')).toBe('old binary payload')
    expect(fs.readFileSync(path.join(worktree, '.fake-version'), 'utf8')).toBe('1.0.0')
  })

  it('leaves no staging or retired debris behind on success', () => {
    const cache = makeTmpDir()
    execFileSync.mockImplementationOnce(((_cmd: string, args: string[]) => {
      fs.writeFileSync(args[args.indexOf('-o') + 1], PAYLOAD)
      return ''
    }) as never)

    downloadTool(tool, 'test-arch', cache)

    expect(fs.readdirSync(cache).filter((e) => e.startsWith('.staging-') || e.startsWith('.retired-'))).toEqual([])
  })
})
