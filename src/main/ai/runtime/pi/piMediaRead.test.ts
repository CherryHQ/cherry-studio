import path from 'node:path'

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { wrapPiReadToolForMedia } from './piMediaRead'

const analyzeToFullText = vi.fn()
const originalGet = vi.mocked(application.get).getMockImplementation()

const ANALYSIS = [
  '## Audio transcript',
  '[0:01] four seasons',
  '## Visual scenes',
  '[0:02] a dark title card',
  '## On-screen text',
  '[0:02] LAURA'
].join('\n')

const IMAGE_RESULT = {
  content: [
    { type: 'text' as const, text: 'Read image file [image/png]' },
    { type: 'image' as const, data: 'frame-bytes', mimeType: 'image/png' }
  ],
  details: undefined
}

function readDefinition(execute: ToolDefinition['execute']): ToolDefinition {
  return {
    name: 'read',
    label: 'read',
    description: 'Read the contents of a file.',
    promptGuidelines: ['Use read to examine files instead of cat or sed.'],
    parameters: { type: 'object' },
    execute
  }
}

function execute(
  tool: ToolDefinition,
  filePath: string,
  options?: { signal?: AbortSignal; cwd?: string; offset?: number; limit?: number }
) {
  const params: { path: string; offset?: number; limit?: number } = { path: filePath }
  if (options?.offset !== undefined) params.offset = options.offset
  if (options?.limit !== undefined) params.limit = options.limit
  return tool.execute('call-1', params, options?.signal, undefined, {
    cwd: options?.cwd ?? '/workspace'
  } as never)
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((part) => part.type === 'text')?.text
  if (text === undefined) throw new Error('expected text content')
  return text
}

describe('wrapPiReadToolForMedia', () => {
  beforeEach(() => {
    analyzeToFullText.mockReset()
    analyzeToFullText.mockResolvedValue(ANALYSIS)
    vi.mocked(application.get).mockImplementation((name) => {
      if (name === 'MediaAnalysisService') return { analyzeToFullText } as never
      if (!originalGet) throw new Error(`[MockApplication] Unknown service: ${name}`)
      return originalGet(name)
    })
  })

  afterEach(() => {
    if (originalGet) vi.mocked(application.get).mockImplementation(originalGet)
  })

  it('returns audio, OCR, and vision text for an attached video path and does not read it as bytes', async () => {
    const original = vi.fn()
    const tool = wrapPiReadToolForMedia(readDefinition(original), '/workspace')
    const videoPath = '/library/S1E01_Four_Seasons_LAURA_CLEAN.mp4'

    await expect(execute(tool, videoPath)).resolves.toEqual({
      content: [{ type: 'text', text: ANALYSIS }],
      details: undefined
    })

    expect(analyzeToFullText).toHaveBeenCalledWith({ kind: 'path', path: videoPath }, undefined)
    expect(original).not.toHaveBeenCalled()
    expect(tool.name).toBe('read')
  })

  it('returns the same analysis text when a later turn reads the existing path again', async () => {
    const tool = wrapPiReadToolForMedia(readDefinition(vi.fn()), '/workspace')
    const videoPath = '/library/S3E05_The_Past_Within.mp4'

    const first = await execute(tool, videoPath)
    const second = await execute(tool, videoPath)

    expect(second).toEqual({ content: [{ type: 'text', text: ANALYSIS }], details: undefined })
    expect(second).toEqual(first)
    expect(second.content.some((part) => part.type === 'image')).toBe(false)
    expect(analyzeToFullText).toHaveBeenNthCalledWith(2, { kind: 'path', path: videoPath }, undefined)
  })

  it('analyzes a relative audio path from the session cwd', async () => {
    const tool = wrapPiReadToolForMedia(readDefinition(vi.fn()), '/workspace')

    await expect(execute(tool, 'voice.wav', { cwd: '/library' })).resolves.toEqual({
      content: [{ type: 'text', text: ANALYSIS }],
      details: undefined
    })
    expect(analyzeToFullText).toHaveBeenCalledWith(
      { kind: 'path', path: path.resolve('/library', 'voice.wav') },
      undefined
    )
  })

  it('delegates ordinary and image reads to the original read tool', async () => {
    const original: ToolDefinition['execute'] = async (_toolCallId, params) => {
      const requestedPath =
        params && typeof params === 'object' && 'path' in params && typeof params.path === 'string' ? params.path : ''
      const offset =
        params && typeof params === 'object' && 'offset' in params && typeof params.offset === 'number'
          ? params.offset
          : undefined
      if (requestedPath.endsWith('.png')) return IMAGE_RESULT
      return { content: [{ type: 'text' as const, text: `notes@${offset}` }], details: undefined }
    }
    const tool = wrapPiReadToolForMedia(readDefinition(original), '/workspace')
    const signal = new AbortController().signal

    await expect(execute(tool, 'notes.txt', { signal, offset: 2 })).resolves.toEqual({
      content: [{ type: 'text', text: 'notes@2' }],
      details: undefined
    })
    await expect(execute(tool, '/library/frame.png', { signal })).resolves.toEqual(IMAGE_RESULT)
    expect(analyzeToFullText).not.toHaveBeenCalled()
  })

  it('pages analysis with offset and limit, then continues at the advertised offset', async () => {
    const tool = wrapPiReadToolForMedia(readDefinition(vi.fn()), '/workspace')
    const videoPath = '/library/S1E01_Four_Seasons_LAURA_CLEAN.mp4'

    const page = await execute(tool, videoPath, { offset: 2, limit: 1 })
    expect(page).toEqual({
      content: [{ type: 'text', text: '[0:01] four seasons\n\n[4 more lines in file. Use offset=3 to continue.]' }],
      details: undefined
    })

    const next = await execute(tool, videoPath, { offset: 3, limit: 1 })
    expect(next).toEqual({
      content: [{ type: 'text', text: '## Visual scenes\n\n[3 more lines in file. Use offset=4 to continue.]' }],
      details: undefined
    })

    await expect(execute(tool, videoPath, { offset: 99 })).rejects.toThrow(
      'Offset 99 is beyond end of file (6 lines total)'
    )
  })

  it('caps analysis at the Pi read line limit and continues from the advertised offset', async () => {
    const total = DEFAULT_MAX_LINES + 1
    const lines = Array.from({ length: total }, (_, index) => `scene ${index + 1}`)
    analyzeToFullText.mockResolvedValue(lines.join('\n'))
    const tool = wrapPiReadToolForMedia(readDefinition(vi.fn()), '/workspace')
    const videoPath = '/library/long.mp4'

    const first = await execute(tool, videoPath)
    expect(first).toEqual({
      content: [
        {
          type: 'text',
          text: `${lines.slice(0, DEFAULT_MAX_LINES).join('\n')}\n\n[Showing lines 1-${DEFAULT_MAX_LINES} of ${total}. Use offset=${total} to continue.]`
        }
      ],
      details: undefined
    })

    const second = await execute(tool, videoPath, { offset: total })
    expect(second).toEqual({ content: [{ type: 'text', text: `scene ${total}` }], details: undefined })
  })

  it('bounds an oversized analysis line without sending the model to bash', async () => {
    const head = 'a'.repeat(DEFAULT_MAX_BYTES - 3)
    analyzeToFullText.mockResolvedValue(`${head}\uD83C\uDFB5more`)
    const tool = wrapPiReadToolForMedia(readDefinition(vi.fn()), '/workspace')

    const text = textOf(await execute(tool, '/library/wide.mp4'))
    const [clipped, notice] = text.split('\n\n')

    expect(clipped).toBe(head)
    expect(Buffer.byteLength(clipped, 'utf-8')).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
    expect(notice).toBe(
      `[Line 1 exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Showing the first ${formatSize(Buffer.byteLength(head, 'utf-8'))}.]`
    )
    expect(text).not.toContain('bash')
    expect(text).not.toContain('\uD83C')
    expect(text).not.toContain('more')
  })

  it('propagates the abort reason and does not return analysis text', async () => {
    const original = vi.fn()
    const tool = wrapPiReadToolForMedia(readDefinition(original), '/workspace')
    const controller = new AbortController()
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    analyzeToFullText.mockImplementation((_file: unknown, signal: AbortSignal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError))
      })
    })

    const pending = execute(tool, '/library/clip.mp4', { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toBe(abortError)
    expect(original).not.toHaveBeenCalled()

    const reason = new Error('cancelled')
    reason.name = 'AbortError'
    const alreadyAborted = new AbortController()
    alreadyAborted.abort(reason)
    await expect(execute(tool, '/library/clip.mp4', { signal: alreadyAborted.signal })).rejects.toBe(reason)
    expect(analyzeToFullText).toHaveBeenCalledTimes(1)
  })

  it('rejects the original abort reason when analysis resolves after the signal aborts', async () => {
    const reason = new Error('turn cancelled')
    reason.name = 'AbortError'
    const controller = new AbortController()
    analyzeToFullText.mockImplementation(async () => {
      controller.abort(reason)
      return ANALYSIS
    })
    const tool = wrapPiReadToolForMedia(readDefinition(vi.fn()), '/workspace')

    await expect(execute(tool, '/library/clip.mp4', { signal: controller.signal })).rejects.toBe(reason)
  })
})
