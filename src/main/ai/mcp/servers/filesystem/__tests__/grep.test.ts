import fs from 'fs/promises'
import path from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { callBuiltinTool, toolText } from '../../__tests__/builtinMcpClient'
import { createFileSystemServer } from '../server'
import * as types from '../types'

async function grepTool(args: Record<string, unknown>, root: string) {
  const result = await callBuiltinTool(() => createFileSystemServer(root), 'grep', args)
  if (result.isError) throw new Error(toolText(result))
  return result
}

const getTextContent = toolText

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

    const runRipgrepSpy = vi
      .spyOn(types, 'runRipgrep')
      .mockResolvedValue({ ok: true, stdout: '', stderr: '', exitCode: 1 })

    // A pattern that, without `--`, ripgrep would interpret as its preprocessor flag (→ RCE).
    await grepTool({ pattern: '--pre=/bin/sh', path: workspaceRoot }, workspaceRoot)

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

  it('accepts ripgrep regex syntax that JavaScript does not support', async () => {
    const workspaceRoot = await createTempDir('grep-ripgrep-regex-root-')
    const pattern = '(?P<word>foo)'
    const runRipgrepSpy = vi
      .spyOn(types, 'runRipgrep')
      .mockResolvedValue({ ok: true, stdout: '', stderr: '', exitCode: 1 })

    const result = await grepTool({ pattern, path: workspaceRoot }, workspaceRoot)

    expect(runRipgrepSpy).toHaveBeenCalledOnce()
    expect(runRipgrepSpy.mock.calls[0][0]).toContain(pattern)
    expect(getTextContent(result)).toBe('No matches found')
  })

  it('rejects unsupported regex syntax when manual search is required', async () => {
    const workspaceRoot = await createTempDir('grep-fallback-regex-root-')
    const pattern = '(?P<word>foo)'
    vi.spyOn(types, 'runRipgrep').mockResolvedValue({ ok: false, stdout: '', stderr: '', exitCode: null })

    await expect(grepTool({ pattern, path: workspaceRoot }, workspaceRoot)).rejects.toThrow(
      `Invalid regex pattern: ${pattern}`
    )
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
      stderr: '',
      exitCode: 0
    })

    const result = await grepTool({ pattern: 'needle', path: matchedFile }, workspaceRoot)
    const rgArgs = runRipgrepSpy.mock.calls[0][0]

    expect(rgArgs).toContain('--no-config')
    expect(rgArgs).toContain('--json')
    expect(rgArgs).not.toContain('--field-match-separator')
    expect(getTextContent(result)).toContain(matchedFile)
    expect(getTextContent(result)).toContain(`12: ${matchContent}`)
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
      stderr: '',
      exitCode: 0
    })

    const result = await grepTool({ pattern: 'needle', path: matchedFile }, workspaceRoot)

    expect(getTextContent(result)).toContain(matchedFile)
    expect(getTextContent(result)).toContain('1: needle')
    expect(getTextContent(result)).not.toContain('99: stale')
  })
  it('attributes matches to colon-bearing paths and decodes plain `lines.text` payloads', async () => {
    const workspaceRoot = await createTempDir('grep-colon-root-')
    // Stands in for a Windows drive-letter path, which colon-splitting the old text
    // output truncated to `C`. POSIX allows the colon, so this runs on every CI OS.
    const matchedFile = path.join(workspaceRoot, 'C:notes.txt')
    await fs.writeFile(matchedFile, 'needle here')

    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({
        type: 'match',
        data: { path: { text: matchedFile }, lines: { text: 'needle here\n' }, line_number: 7 }
      }),
      stderr: '',
      exitCode: 0
    })

    const result = await grepTool({ pattern: 'needle', path: matchedFile }, workspaceRoot)

    expect(getTextContent(result)).toContain(`${matchedFile}:`)
    expect(getTextContent(result)).toContain('7: needle here')
  })

  it('skips a binary file that ripgrep searched because it was named explicitly', async () => {
    const workspaceRoot = await createTempDir('grep-binary-root-')
    const binaryFile = path.join(workspaceRoot, 'blob.bin')
    // Real binaries carry mixed low control bytes, not a run of pure NULs.
    const binaryTail = Buffer.alloc(512)
    binaryTail.forEach((_, index) => (binaryTail[index] = index % 8))
    await fs.writeFile(binaryFile, Buffer.concat([Buffer.from('needle in the head\n'), binaryTail]))

    vi.spyOn(types, 'runRipgrep').mockResolvedValue({
      ok: true,
      stdout: [
        JSON.stringify({ type: 'begin', data: { path: { text: binaryFile } } }),
        JSON.stringify({
          type: 'match',
          data: { path: { text: binaryFile }, lines: { text: 'needle in the head\n' }, line_number: 1 }
        }),
        // ripgrep reports the match, then flags the file as binary once it reaches the NULs.
        JSON.stringify({ type: 'end', data: { path: { text: binaryFile }, binary_offset: 19 } })
      ].join('\n'),
      stderr: '',
      exitCode: 0
    })

    const result = await grepTool({ pattern: 'needle', path: binaryFile }, workspaceRoot)

    expect(getTextContent(result)).not.toContain('needle in the head')
    expect(getTextContent(result)).toBe('No matches found')
  })
})
