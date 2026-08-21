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
const { download } = require('../download-binaries')

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
