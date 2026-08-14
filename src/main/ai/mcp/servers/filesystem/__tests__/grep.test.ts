import fs from 'fs/promises'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleGrepTool } from '../tools/grep'
import * as types from '../types'

describe('grep MCP arg injection', () => {
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
    await fs.mkdir(tempRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(tempRoot, prefix))
    tempDirs.push(tempDir)
    return tempDir
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })))
  })

  it('passes pattern after a `--` end-of-options separator so flag-like patterns are literal', async () => {
    const workspaceRoot = await createTempDir('grep-injection-root-')

    const runRipgrepSpy = vi.spyOn(types, 'runRipgrep').mockResolvedValue({ ok: true, stdout: '', exitCode: 1 })

    // A pattern that, without `--`, ripgrep would interpret as its preprocessor flag (→ RCE).
    await handleGrepTool({ pattern: '--pre=/bin/sh', path: workspaceRoot }, workspaceRoot)

    expect(runRipgrepSpy).toHaveBeenCalledTimes(1)
    const rgArgs = runRipgrepSpy.mock.calls[0][0]

    const dashDashIndex = rgArgs.indexOf('--')
    const patternIndex = rgArgs.indexOf('--pre=/bin/sh')

    // `--` must appear and must come immediately before the pattern (and validated path).
    expect(dashDashIndex).toBeGreaterThanOrEqual(0)
    expect(patternIndex).toBe(dashDashIndex + 1)
    // The flag-like pattern is a positional after `--`, not an option ripgrep would parse.
    expect(rgArgs[patternIndex - 1]).toBe('--')
  })
})
