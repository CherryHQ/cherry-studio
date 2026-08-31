import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/downloadAsBase64', () => ({ MAX_FILE_SIZE_BYTES: 8 }))

import { dshToolResultErrorText, projectDshToolResult } from '../dshToolResultProjection'

let tempRoot: string
let agentsDataRoot: string
let toolResultRoot: string

function options(signal?: AbortSignal) {
  return { agentsDataRoot, toolResultRoot, ...(signal ? { signal } : {}) }
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-tool-result-projection-'))
  agentsDataRoot = path.join(tempRoot, 'Agents')
  toolResultRoot = path.join(agentsDataRoot, 'agent-1', 'tool-results', 'v1', 'objects')
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('projectDshToolResult', () => {
  it('keeps the bridge fallback for an empty result', async () => {
    await expect(projectDshToolResult([], 'empty', options())).resolves.toBe('(empty returned no text content)')
  })

  it('deduplicates identical binary blocks and falls back to a bin extension', async () => {
    const bytes = Buffer.from('same')
    const content: CallToolResult['content'] = [
      { type: 'audio', data: bytes.toString('base64'), mimeType: 'unknown' },
      { type: 'audio', data: bytes.toString('base64'), mimeType: 'unknown' }
    ]

    const text = await projectDshToolResult(content, 'repeat', options())
    const matches = [...text.matchAll(/saved to ("[^"]+")/g)].map((match) => JSON.parse(match[1]) as string)

    expect(matches).toHaveLength(2)
    expect(matches[0]).toBe(matches[1])
    expect(matches[0]).toMatch(/\.bin$/)
    await expect(readFile(matches[0])).resolves.toEqual(bytes)
    await expect(readdir(path.dirname(matches[0]))).resolves.toEqual([path.basename(matches[0])])
  })

  it('rejects invalid base64 and aggregate overflow before creating result storage', async () => {
    await expect(
      projectDshToolResult([{ type: 'image', data: '', mimeType: 'image/png' }], 'empty', options())
    ).rejects.toThrow('invalid base64')
    await expect(
      projectDshToolResult([{ type: 'image', data: 'not-base64', mimeType: 'image/png' }], 'invalid', options())
    ).rejects.toThrow('invalid base64')
    await expect(access(toolResultRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const fiveBytes = Buffer.from('12345').toString('base64')
    await expect(
      projectDshToolResult(
        [
          { type: 'audio', data: fiveBytes, mimeType: 'audio/wav' },
          { type: 'audio', data: fiveBytes, mimeType: 'audio/wav' }
        ],
        'oversize',
        options()
      )
    ).rejects.toThrow('more than 8 bytes')
    await expect(access(toolResultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('honors cancellation and rejects result roots outside managed Agent storage', async () => {
    const controller = new AbortController()
    controller.abort()
    const content: CallToolResult['content'] = [
      { type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }
    ]

    await expect(projectDshToolResult(content, 'cancelled', options(controller.signal))).rejects.toMatchObject({
      name: 'AbortError'
    })
    await expect(access(toolResultRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const outsideRoot = path.join(tempRoot, 'outside')
    await expect(
      projectDshToolResult(content, 'unsafe', { agentsDataRoot, toolResultRoot: outsideRoot })
    ).rejects.toThrow('escapes its root')
    await expect(access(outsideRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('surfaces an atomic write failure as a failed projection', async () => {
    const bytes = Buffer.from('image')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const target = path.join(toolResultRoot, digest.slice(0, 2), `${digest}.png`)
    await mkdir(target, { recursive: true })

    await expect(
      projectDshToolResult(
        [{ type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' }],
        'write-failure',
        options()
      )
    ).rejects.toThrow()
    expect((await stat(target)).isDirectory()).toBe(true)
  })
})

describe('dshToolResultErrorText', () => {
  it('keeps text details and ignores binary error blocks', () => {
    const content: CallToolResult['content'] = [
      { type: 'image', data: Buffer.from('secret').toString('base64'), mimeType: 'image/png' },
      { type: 'text', text: 'failed' },
      { type: 'resource', resource: { uri: 'file:///details', text: 'details' } }
    ]

    expect(dshToolResultErrorText(content, 'tool')).toBe('failed\ndetails')
  })
})
