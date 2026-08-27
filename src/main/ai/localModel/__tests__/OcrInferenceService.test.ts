import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ProxyRoutingSnapshot } from '@main/services/proxy/proxyRouting'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the whole OCR chain — real worker source, real {@link InferenceServiceBase},
 * real service — because the hops in between rebuild the result field by field: a field
 * the worker emits can still be dropped before the caller sees it, and a worker-only
 * test stays green while that happens.
 *
 * The fake engine echoes the bytes it was handed back as `text`, which is what lets a
 * test tell an in-memory buffer apart from a disk read.
 */
const PADDLE_FAKE = String.raw`
export class PaddleOcrService {
  constructor(options) {
    this.options = options
  }

  async initialize() {}

  async recognize(image) {
    const text = new TextDecoder().decode(image)
    // Sentinel for an engine result that carries no boxes at all (nothing detected).
    if (text === 'no-lines') return { text, confidence: 0 }
    return {
      text,
      confidence: 0.91,
      lines: [[{ text, box: { x: 12, y: 34, width: 56, height: 78 }, confidence: 0.87 }]]
    }
  }

  async destroy() {}
}
`

const DIRECT_ROUTING: ProxyRoutingSnapshot = { version: 1, mode: 'direct' }

// The temp app root only exists once beforeAll has run; the mock reads it lazily.
const { appRoot, getRoutingSnapshot } = vi.hoisted(() => ({
  appRoot: { path: '' },
  getRoutingSnapshot: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ProxyService') return { getRoutingSnapshot }
    return originalGet(name)
  })
  const originalGetPath = result.application.getPath.getMockImplementation()!
  result.application.getPath.mockImplementation((key: string, filename?: string) =>
    // The worker resolves ppu-paddle-ocr off the app root — point it at the fake.
    key === 'app.root' ? appRoot.path : originalGetPath(key, filename)
  )
  return result
})

// Pin to a supported platform so the suite is deterministic regardless of the host.
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

const { OcrInferenceService } = await import('../OcrInferenceService')
const ocrInferenceService = new OcrInferenceService()

const MODEL_PATHS = {
  detection: '/models/paddleocr/det.onnx',
  recognition: '/models/paddleocr/rec.onnx',
  charactersDictionary: '/models/paddleocr/dict.txt'
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

beforeAll(async () => {
  getRoutingSnapshot.mockResolvedValue(DIRECT_ROUTING)
  appRoot.path = await mkdtemp(path.join(tmpdir(), 'cherry-ocr-inference-'))
  const paddleDir = path.join(appRoot.path, 'node_modules', 'ppu-paddle-ocr')
  await mkdir(paddleDir, { recursive: true })
  await writeFile(
    path.join(paddleDir, 'package.json'),
    JSON.stringify({ name: 'ppu-paddle-ocr', type: 'module', exports: './index.js' })
  )
  await writeFile(path.join(paddleDir, 'index.js'), PADDLE_FAKE)
})

afterAll(async () => {
  await ocrInferenceService.terminate()
  await rm(appRoot.path, { recursive: true, force: true })
})

describe('OcrInferenceService.recognize', () => {
  it('feeds in-memory bytes straight to the engine, with no file on disk to read', async () => {
    const result = await ocrInferenceService.recognize(MODEL_PATHS, { kind: 'bytes', imageBytes: bytes('from-memory') })

    expect(result.text).toBe('from-memory')
  })

  it('still reads a path source off disk', async () => {
    const imagePath = path.join(appRoot.path, 'page.bin')
    await writeFile(imagePath, 'from-disk')

    const result = await ocrInferenceService.recognize(MODEL_PATHS, { kind: 'path', imagePath })

    expect(result.text).toBe('from-disk')
  })

  it('delivers the engine boxes to the caller unchanged', async () => {
    const result = await ocrInferenceService.recognize(MODEL_PATHS, { kind: 'bytes', imageBytes: bytes('boxed') })

    // Boxes are what a selectable text layer is drawn from — losing or reshaping them
    // anywhere between the worker and here leaves the overlay with text and no geometry.
    expect(result.lines).toEqual([[{ text: 'boxed', box: { x: 12, y: 34, width: 56, height: 78 }, confidence: 0.87 }]])
  })

  it('reports no boxes as an empty list, so callers never guard against null', async () => {
    const result = await ocrInferenceService.recognize(MODEL_PATHS, { kind: 'bytes', imageBytes: bytes('no-lines') })

    expect(result.lines).toEqual([])
    expect(result.text).toBe('no-lines')
  })

  it('fails a path source that does not exist instead of recognizing an empty image', async () => {
    const missing = path.join(appRoot.path, 'missing.png')

    await expect(ocrInferenceService.recognize(MODEL_PATHS, { kind: 'path', imagePath: missing })).rejects.toThrow(
      /ENOENT/
    )
  })
})
