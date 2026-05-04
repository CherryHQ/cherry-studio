import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { extractImageTextMock, extractDocumentTextMock, parseOfficeAsyncMock } = vi.hoisted(() => ({
  extractImageTextMock: vi.fn(),
  extractDocumentTextMock: vi.fn(),
  parseOfficeAsyncMock: vi.fn()
}))

vi.mock('@data/services/FileProcessingService', () => ({
  fileProcessingService: {
    extractImageText: extractImageTextMock,
    extractDocumentText: extractDocumentTextMock
  }
}))

vi.mock('officeparser', () => ({
  default: { parseOfficeAsync: parseOfficeAsyncMock },
  parseOfficeAsync: parseOfficeAsyncMock
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { createReadFileToolEntry, FS_READ_TOOL_NAME } from '../readFile'

const entry = createReadFileToolEntry()

interface ReadInput {
  path: string
  offset?: number
  limit?: number
}
type ReadOutput =
  | { kind: 'text'; text: string; startLine: number; endLine: number; totalLines: number }
  | { kind: 'image'; data: string; mimeType: string }
  | { kind: 'pdf'; data: string; mediaType: 'application/pdf' }
  | { kind: 'media'; data: string; mediaType: string }
  | { kind: 'error'; code: string; message: string }

interface ContextOverride {
  topicId?: string
  model?: unknown
  provider?: unknown
}

const visionModel = {
  id: 'openai::gpt-4o',
  name: 'gpt-4o',
  capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION]
}
const textOnlyModel = {
  id: 'mock-vendor::tiny-text',
  name: 'tiny-text',
  capabilities: []
}
const audioModel = {
  id: 'google::gemini-2.0-flash',
  name: 'gemini-2.0-flash',
  capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION]
}
const videoModel = {
  id: 'google::gemini-2.0-flash',
  name: 'gemini-2.0-flash',
  capabilities: [MODEL_CAPABILITY.VIDEO_RECOGNITION]
}
const anthropicNativePdfModel = {
  id: 'anthropic::claude-3-5-sonnet-20241022',
  name: 'claude-3-5-sonnet',
  capabilities: []
}
const openaiCompatProvider = { id: 'openai-compat', type: 'openai-compatible' }
const anthropicProvider = { id: 'anthropic', type: 'anthropic' }

async function callExecute(args: ReadInput, ctx: ContextOverride = {}): Promise<ReadOutput> {
  const execute = entry.tool.execute as (args: ReadInput, options: ToolExecutionOptions) => Promise<ReadOutput>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: {
      requestId: 'req-1',
      topicId: ctx.topicId ?? 'topic-default',
      // Default to a vision-capable model so the image branch works
      // out of the box for tests that don't care about gating.
      model: ctx.model ?? visionModel,
      provider: ctx.provider
    }
  } as ToolExecutionOptions)
}

function callToModelOutput(output: ReadOutput): { type: string; value: string } {
  const fn = (
    entry.tool as {
      toModelOutput: (opts: { toolCallId: string; input: unknown; output: ReadOutput }) => {
        type: string
        value: string
      }
    }
  ).toModelOutput
  return fn({ toolCallId: 'tc-1', input: { path: '/x' }, output })
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-read-test-'))
  extractImageTextMock.mockReset()
  extractDocumentTextMock.mockReset()
  parseOfficeAsyncMock.mockReset()
})

afterEach(async () => {
  MockMainCacheServiceUtils.resetMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// =====================================================================
// Tool entry registration
// =====================================================================

describe('fs__read entry', () => {
  it('registers under fs namespace as Read capability', () => {
    expect(entry.name).toBe(FS_READ_TOOL_NAME)
    expect(entry.namespace).toBe('fs')
    expect(entry.capability).toBe('read')
  })
})

// =====================================================================
// Foundation: text reading, pagination, validation
// =====================================================================

describe('fs__read text path', () => {
  it('rejects relative paths', async () => {
    const result = await callExecute({ path: 'foo.txt' })
    expect(result).toEqual({ kind: 'error', code: 'relative-path', message: expect.stringContaining('foo.txt') })
  })

  it('returns not-found for missing files', async () => {
    const result = await callExecute({ path: path.join(tmpDir, 'missing.txt') })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.code).toBe('not-found')
  })

  it('returns not-a-file when path is a directory', async () => {
    const result = await callExecute({ path: tmpDir })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.code).toBe('not-a-file')
  })

  it('rejects binary files (null byte heuristic)', async () => {
    const filePath = path.join(tmpDir, 'image.bin')
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.code).toBe('binary')
  })

  it('returns line-numbered text for small text files', async () => {
    const filePath = path.join(tmpDir, 'hello.txt')
    await fs.writeFile(filePath, 'one\ntwo\nthree')
    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.startLine).toBe(1)
      expect(result.endLine).toBe(3)
      expect(result.totalLines).toBe(3)
      expect(result.text).toContain('1\tone')
      expect(result.text).toContain('2\ttwo')
      expect(result.text).toContain('3\tthree')
    }
  })

  it('honours offset + limit pagination', async () => {
    const filePath = path.join(tmpDir, 'big.txt')
    const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
    await fs.writeFile(filePath, content)

    const result = await callExecute({ path: filePath, offset: 50, limit: 5 })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.startLine).toBe(50)
      expect(result.endLine).toBe(54)
      expect(result.totalLines).toBe(100)
      expect(result.text).toContain('line 50')
      expect(result.text).toContain('line 54')
      expect(result.text).not.toContain('line 55')
    }
  })

  it('returns empty page when offset beyond totalLines', async () => {
    const filePath = path.join(tmpDir, 'short.txt')
    await fs.writeFile(filePath, 'a\nb')
    const result = await callExecute({ path: filePath, offset: 100 })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.text).toBe('')
      expect(result.totalLines).toBe(2)
    }
  })

  it('truncates lines longer than MAX_LINE_LENGTH', async () => {
    const filePath = path.join(tmpDir, 'long.txt')
    await fs.writeFile(filePath, 'x'.repeat(2500))
    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.text.endsWith('...')).toBe(true)
      expect(result.text).toContain('x'.repeat(2000))
    }
  })

  // Note: encoding detection itself is exercised in
  // `src/main/utils/__tests__/file.test.ts` against
  // `readTextFileWithAutoEncoding`. We trust the underlying utility and
  // don't re-test chardet here — short non-UTF-8 samples are
  // probabilistically detected and would make this brittle.
})

// =====================================================================
// Defensive hardening: device blocklist, fifo, size cap, mtime dedup
// =====================================================================

describe('fs__read defensive hardening', () => {
  /**
   * Device-path blocklist applies BEFORE realpath (catches paths that
   * don't exist on the host like /proc on macOS) AND AFTER realpath
   * (catches symlinks resolving to /dev/null). A regression that
   * collapses these would let one of the two through.
   */
  it.each([
    ['direct device path', '/dev/null'],
    ['proc self', '/proc/self/cmdline']
  ])('rejects %s with device-file error', async (_, devicePath) => {
    if (process.platform === 'win32') return
    const result = await callExecute({ path: devicePath })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe('device-file')
  })

  it('rejects symlinks that resolve to device files (realpath BEFORE blocklist)', async () => {
    if (process.platform === 'win32') return
    const linkPath = path.join(tmpDir, 'link-to-null')
    await fs.symlink('/dev/null', linkPath)
    const result = await callExecute({ path: linkPath })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe('device-file')
  })

  /**
   * FIFO/socket detection runs after stat — the path-pattern check
   * doesn't catch user-created fifos under e.g. /tmp.
   */
  it.skipIf(process.platform === 'win32')('rejects FIFO files with pipe-or-socket error', async () => {
    const fifoPath = path.join(tmpDir, 'my-fifo')
    execSync(`mkfifo ${fifoPath}`)
    const result = await callExecute({ path: fifoPath })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe('pipe-or-socket')
  })

  /**
   * 5 MB cap. Both sides of the boundary: 5 MB + 1 byte rejected,
   * 5 MB exactly allowed. Off-by-one bugs (`>` vs `>=`) are exactly
   * what this catches.
   */
  it('rejects files larger than 5 MB with too-large; allows 5 MB exactly', async () => {
    const justOver = path.join(tmpDir, 'just-over.txt')
    const justAt = path.join(tmpDir, 'just-at.txt')
    await fs.writeFile(justOver, 'a'.repeat(5 * 1024 * 1024 + 1))
    await fs.writeFile(justAt, 'a'.repeat(5 * 1024 * 1024))

    const overResult = await callExecute({ path: justOver })
    expect(overResult.kind).toBe('error')
    if (overResult.kind === 'error') expect(overResult.code).toBe('too-large')

    const atResult = await callExecute({ path: justAt })
    expect(atResult.kind).toBe('text')
  })

  /**
   * mtime dedup HIT — second call with same range and unchanged mtime
   * returns a `text` kind whose body starts with the
   * `[unchanged since last read` prefix. The prefix wording is the
   * model interface — it pattern-matches on this string to recognize
   * stale-file feedback.
   */
  it('returns text with [unchanged...] prefix when stored range fully contains requested range', async () => {
    const filePath = path.join(tmpDir, 'cached.txt')
    await fs.writeFile(filePath, 'line 1\nline 2\nline 3\nline 4\nline 5\n')

    const first = await callExecute({ path: filePath })
    expect(first.kind).toBe('text')

    const second = await callExecute({ path: filePath })
    expect(second.kind).toBe('text')
    if (second.kind !== 'text') return
    expect(second.text.startsWith('[unchanged since last read')).toBe(true)
  })

  it('refreshes when requested range extends beyond stored range', async () => {
    const filePath = path.join(tmpDir, 'extends.txt')
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n')
    await fs.writeFile(filePath, lines)

    const first = await callExecute({ path: filePath, offset: 1, limit: 100 })
    expect(first.kind).toBe('text')

    const second = await callExecute({ path: filePath, offset: 1, limit: 200 })
    expect(second.kind).toBe('text')
    if (second.kind !== 'text') return
    expect(second.text.startsWith('[unchanged')).toBe(false)
  })

  it('refreshes when file mtime advances between calls', async () => {
    const filePath = path.join(tmpDir, 'mtime.txt')
    await fs.writeFile(filePath, 'first content\n')

    const first = await callExecute({ path: filePath })
    expect(first.kind).toBe('text')

    const future = new Date(Date.now() + 5000)
    await fs.writeFile(filePath, 'second content\n')
    await fs.utimes(filePath, future, future)

    const second = await callExecute({ path: filePath })
    expect(second.kind).toBe('text')
    if (second.kind !== 'text') return
    expect(second.text.startsWith('[unchanged')).toBe(false)
  })

  /**
   * Cross-topic isolation. A regression that uses only absPath as
   * cache key would silently report "unchanged" to a topic that has
   * never read the file before.
   */
  it('treats reads from different topics as separate cache entries', async () => {
    const filePath = path.join(tmpDir, 'shared.txt')
    await fs.writeFile(filePath, 'shared content\n')

    const fromA = await callExecute({ path: filePath }, { topicId: 'topic-A' })
    expect(fromA.kind).toBe('text')

    const fromB = await callExecute({ path: filePath }, { topicId: 'topic-B' })
    expect(fromB.kind).toBe('text')
    if (fromB.kind !== 'text') return
    expect(fromB.text.startsWith('[unchanged')).toBe(false)
  })
})

// =====================================================================
// Format dispatch: image / pdf / office / ipynb / unknown
// =====================================================================

describe('fs__read format dispatch', () => {
  /**
   * PNG → image kind with raw bytes (no resize). Providers handle
   * their own wire compression — re-encoding here would discard
   * fidelity for no benefit.
   */
  it('reads PNG as image kind with raw bytes for vision models', async () => {
    const filePath = path.join(tmpDir, 'pic.png')
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 128, b: 255 } } })
      .png()
      .toFile(filePath)
    const onDisk = await fs.readFile(filePath)

    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('image')
    if (result.kind !== 'image') return
    expect(result.mimeType).toBe('image/png')
    expect(Buffer.from(result.data, 'base64').equals(onDisk)).toBe(true)
  })

  /**
   * PDF without a native-PDF provider routes through
   * fileProcessingService.extractDocumentText — mocked here so the
   * test doesn't depend on a real PDF fixture.
   */
  it('reads PDF as text kind via extractDocumentText for non-native providers', async () => {
    const filePath = path.join(tmpDir, 'doc.pdf')
    await fs.writeFile(filePath, '%PDF-1.4\nfake bytes\n')
    extractDocumentTextMock.mockResolvedValue('Page one body line\nPage one body line 2')

    const result = await callExecute({ path: filePath }, { provider: openaiCompatProvider, model: textOnlyModel })
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('Page one body line')
    expect(extractDocumentTextMock).toHaveBeenCalledOnce()
  })

  /**
   * DOCX/XLSX go DIRECTLY through officeparser, no facade — the
   * dispatcher catches officeparser's errors and surfaces parse-error.
   */
  it('reads DOCX as text kind via officeparser', async () => {
    const filePath = path.join(tmpDir, 'doc.docx')
    await fs.writeFile(filePath, 'fake docx bytes (lib mocked)')
    parseOfficeAsyncMock.mockResolvedValue('Hello from docx')

    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('Hello from docx')
    expect(parseOfficeAsyncMock).toHaveBeenCalledOnce()
  })

  it('reads XLSX as text kind via officeparser', async () => {
    const filePath = path.join(tmpDir, 'sheet.xlsx')
    await fs.writeFile(filePath, 'fake xlsx bytes (lib mocked)')
    parseOfficeAsyncMock.mockResolvedValue('A1\tB1\nA2\tB2')

    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('A1')
  })

  /**
   * IPYNB markdown cells emitted verbatim; code cells get the same
   * line-numbered envelope as plain text. JSON parsing is in-process,
   * no mocking needed.
   */
  it('reads IPYNB as text kind with markdown verbatim and code cells line-numbered', async () => {
    const filePath = path.join(tmpDir, 'nb.ipynb')
    const notebook = {
      cells: [
        { cell_type: 'markdown', source: ['# Heading\n', 'Some prose.'] },
        { cell_type: 'code', source: ['x = 1\n', 'y = 2\n'] }
      ]
    }
    await fs.writeFile(filePath, JSON.stringify(notebook))

    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('# Heading')
    expect(result.text).toContain('Some prose.')
    expect(result.text).toMatch(/\s*1\s*\tx = 1/)
    expect(result.text).toMatch(/\s*2\s*\ty = 2/)
  })

  it('returns parse-error when officeparser throws', async () => {
    const filePath = path.join(tmpDir, 'corrupt.docx')
    await fs.writeFile(filePath, 'corrupt bytes')
    parseOfficeAsyncMock.mockRejectedValue(new Error('zip: bad magic'))

    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe('parse-error')
  })

  /**
   * Unknown extension falls through to the binary check — a `.xyz`
   * file that's actually text reads as text. A dispatcher regression
   * that short-circuits unknown extensions to an error would break
   * extensionless config files (Makefile, Dockerfile-style).
   */
  it('falls through to text/binary check for unknown extensions', async () => {
    const filePath = path.join(tmpDir, 'note.unknownext')
    await fs.writeFile(filePath, 'plain text content\nline two\n')

    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('plain text content')
    expect(parseOfficeAsyncMock).not.toHaveBeenCalled()
  })
})

// =====================================================================
// Capability gating: vision / native-PDF
// =====================================================================

describe('fs__read capability gating', () => {
  it('falls back to OCR via fileProcessingService when model is not vision-capable', async () => {
    const filePath = path.join(tmpDir, 'pic.png')
    await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toFile(filePath)
    extractImageTextMock.mockResolvedValue('OCR’d body text')

    const result = await callExecute({ path: filePath }, { model: textOnlyModel })
    expect(extractImageTextMock).toHaveBeenCalledWith(expect.stringContaining('pic.png'))
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('OCR’d body text')
  })

  it('returns image kind without calling OCR when model is vision-capable', async () => {
    const filePath = path.join(tmpDir, 'pic.png')
    await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toFile(filePath)

    const result = await callExecute({ path: filePath }, { model: visionModel })
    expect(result.kind).toBe('image')
    if (result.kind !== 'image') return
    expect(result.mimeType).toBe('image/png')
    expect(extractImageTextMock).not.toHaveBeenCalled()
  })

  it('returns pdf kind with raw bytes when provider+model accept native PDF', async () => {
    const filePath = path.join(tmpDir, 'doc.pdf')
    const fakePdfBytes = Buffer.from('%PDF-1.4\nfake bytes\n')
    await fs.writeFile(filePath, fakePdfBytes)

    const result = await callExecute(
      { path: filePath },
      { provider: anthropicProvider, model: anthropicNativePdfModel }
    )
    expect(result.kind).toBe('pdf')
    if (result.kind !== 'pdf') return
    expect(result.mediaType).toBe('application/pdf')
    expect(Buffer.from(result.data, 'base64').equals(fakePdfBytes)).toBe(true)
    expect(extractDocumentTextMock).not.toHaveBeenCalled()
  })

  it('emits media kind with raw bytes when model is audio-capable', async () => {
    const filePath = path.join(tmpDir, 'sound.mp3')
    const fakeAudio = Buffer.from('ID3\x03\x00\x00\x00fake audio bytes')
    await fs.writeFile(filePath, fakeAudio)

    const result = await callExecute({ path: filePath }, { model: audioModel })
    expect(result.kind).toBe('media')
    if (result.kind !== 'media') return
    expect(result.mediaType).toBe('audio/mpeg')
    expect(Buffer.from(result.data, 'base64').equals(fakeAudio)).toBe(true)
  })

  it('returns unsupported-modality for audio when model is not audio-capable', async () => {
    const filePath = path.join(tmpDir, 'sound.mp3')
    await fs.writeFile(filePath, Buffer.from('fake audio bytes'))

    const result = await callExecute({ path: filePath }, { model: textOnlyModel })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe('unsupported-modality')
  })

  it('emits media kind with raw bytes when model is video-capable', async () => {
    const filePath = path.join(tmpDir, 'clip.mp4')
    const fakeVideo = Buffer.from('\x00\x00\x00\x18ftypmp42fake video bytes')
    await fs.writeFile(filePath, fakeVideo)

    const result = await callExecute({ path: filePath }, { model: videoModel })
    expect(result.kind).toBe('media')
    if (result.kind !== 'media') return
    expect(result.mediaType).toBe('video/mp4')
    expect(Buffer.from(result.data, 'base64').equals(fakeVideo)).toBe(true)
  })

  it('returns unsupported-modality for video when model is not video-capable', async () => {
    const filePath = path.join(tmpDir, 'clip.mp4')
    await fs.writeFile(filePath, Buffer.from('fake video bytes'))

    const result = await callExecute({ path: filePath }, { model: visionModel })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.code).toBe('unsupported-modality')
  })

  it('falls back to fileProcessingService.extractDocumentText for non-native PDF', async () => {
    const filePath = path.join(tmpDir, 'doc.pdf')
    await fs.writeFile(filePath, '%PDF-1.4\nfake bytes\n')
    extractDocumentTextMock.mockResolvedValue('Extracted page body')

    const result = await callExecute({ path: filePath }, { provider: openaiCompatProvider, model: textOnlyModel })
    expect(result.kind).toBe('text')
    if (result.kind !== 'text') return
    expect(result.text).toContain('Extracted page body')
    expect(extractDocumentTextMock).toHaveBeenCalledOnce()
  })
})

// =====================================================================
// toModelOutput: kind → AI SDK chunk
// =====================================================================

describe('fs__read toModelOutput', () => {
  it('text without remaining → plain text block', () => {
    const out = callToModelOutput({
      kind: 'text',
      text: '     1\thello',
      startLine: 1,
      endLine: 1,
      totalLines: 1
    })
    expect(out.type).toBe('text')
    expect(out.value).toBe('     1\thello')
  })

  it('text with remaining → tail with offset hint', () => {
    const out = callToModelOutput({
      kind: 'text',
      text: '     1\ta',
      startLine: 1,
      endLine: 1,
      totalLines: 100
    })
    expect(out.type).toBe('text')
    expect(out.value).toContain('99 more')
    expect(out.value).toContain('offset=2')
  })

  it('error → error-text block', () => {
    const out = callToModelOutput({ kind: 'error', code: 'binary', message: 'oops' })
    expect(out.type).toBe('error-text')
    expect(out.value).toContain('[Error: binary]')
    expect(out.value).toContain('oops')
  })
})
