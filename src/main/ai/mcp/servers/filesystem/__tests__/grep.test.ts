import fs from 'fs/promises'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleGrepTool } from '../tools/grep'
import * as types from '../types'

describe('grep MCP ripgrep integration', () => {
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

  it('parses structured match output for a single-file search', async () => {
    const workspaceRoot = await createTempDir('grep-output-root-')
    const matchedFile = path.join(workspaceRoot, 'match.txt')
    const matchContent = 'needle:34:https://example.com'
    await fs.writeFile(matchedFile, matchContent)

    const runRipgrepSpy = vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [
        JSON.stringify({ type: 'begin', data: { path: { text: matchedFile } } }),
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: matchedFile },
            lines: { bytes: Buffer.from(`${matchContent}\n`).toString('base64') },
            line_number: 12,
            absolute_offset: 0,
            submatches: []
          }
        }),
        JSON.stringify({ type: 'summary', data: {} })
      ].join('\n'),
      exitCode: 0
    })

    const result = await handleGrepTool({ pattern: 'needle', path: matchedFile }, workspaceRoot)
    const rgArgs = runRipgrepSpy.mock.calls[0][0]

    expect(rgArgs).toContain('--no-config')
    expect(rgArgs).toContain('--json')
    expect(rgArgs).not.toContain('--field-match-separator')
    expect(result.content[0].text).toContain(matchedFile)
    expect(result.content[0].text).toContain(`12: ${matchContent}`)
  })

  it('falls back to manual search when ripgrep returns malformed match output', async () => {
    const workspaceRoot = await createTempDir('grep-fallback-root-')
    const matchedFile = path.join(workspaceRoot, 'match.txt')
    await fs.writeFile(matchedFile, 'needle')

    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [
        JSON.stringify({
          type: 'match',
          data: { path: { text: matchedFile }, lines: { text: 'stale\n' }, line_number: 99 }
        }),
        'malformed output'
      ].join('\n'),
      exitCode: 0
    })

    const result = await handleGrepTool({ pattern: 'needle', path: matchedFile }, workspaceRoot)

    expect(result.content[0].text).toContain(matchedFile)
    expect(result.content[0].text).toContain('1: needle')
    expect(result.content[0].text).not.toContain('99: stale')
  })
})
