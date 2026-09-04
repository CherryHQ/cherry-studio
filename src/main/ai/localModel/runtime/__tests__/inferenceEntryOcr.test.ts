import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'
import type { OcrHandlers } from './inferenceEntryHarness'
import { loadInferenceEntries } from './inferenceEntryHarness'

/**
 * Covers what the OCR handler owes its caller regardless of the engine: an in-memory image
 * never round-trips through disk, a path source still does, boxes reach the caller
 * unreshaped, and "nothing detected" is an empty list rather than a missing field.
 *
 * The fake engine echoes the bytes it was handed back as `text`, which is what lets a test
 * tell an in-memory buffer apart from a disk read.
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

const MODEL_PATHS = {
  detection: '/models/paddleocr/det.onnx',
  recognition: '/models/paddleocr/rec.onnx',
  charactersDictionary: '/models/paddleocr/dict.txt'
}

let appRoot: string
let ocr: OcrHandlers

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

beforeAll(async () => {
  appRoot = await mkdtemp(path.join(tmpdir(), 'cherry-ocr-inference-'))
  const paddleDir = path.join(appRoot, 'node_modules', 'ppu-paddle-ocr')
  await mkdir(paddleDir, { recursive: true })
  await writeFile(
    path.join(paddleDir, 'package.json'),
    JSON.stringify({ name: 'ppu-paddle-ocr', type: 'module', exports: './index.js' })
  )
  await writeFile(path.join(paddleDir, 'index.js'), PADDLE_FAKE)

  ocr = (
    await loadInferenceEntries({
      appPath: appRoot,
      artifactPaths: {},
      runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
    })
  ).ocr
})

afterAll(async () => {
  vi.resetModules()
  await rm(appRoot, { recursive: true, force: true })
})

describe('OCR entry recognize', () => {
  it('feeds in-memory bytes straight to the engine, with no file on disk to read', async () => {
    const result = await ocr.recognize({
      modelPaths: MODEL_PATHS,
      source: { kind: 'bytes', imageBytes: bytes('from-memory') }
    })

    expect(result.text).toBe('from-memory')
  })

  it('still reads a path source off disk', async () => {
    const imagePath = path.join(appRoot, 'page.bin')
    await writeFile(imagePath, 'from-disk')

    const result = await ocr.recognize({ modelPaths: MODEL_PATHS, source: { kind: 'path', imagePath } })

    expect(result.text).toBe('from-disk')
  })

  it('delivers the engine boxes to the caller unchanged', async () => {
    const result = await ocr.recognize({
      modelPaths: MODEL_PATHS,
      source: { kind: 'bytes', imageBytes: bytes('boxed') }
    })

    // Boxes are what a selectable text layer is drawn from — losing or reshaping them
    // anywhere between the engine and here leaves the overlay with text and no geometry.
    expect(result.lines).toEqual([[{ text: 'boxed', box: { x: 12, y: 34, width: 56, height: 78 }, confidence: 0.87 }]])
  })

  it('reports no boxes as an empty list, so callers never guard against null', async () => {
    const result = await ocr.recognize({
      modelPaths: MODEL_PATHS,
      source: { kind: 'bytes', imageBytes: bytes('no-lines') }
    })

    expect(result.lines).toEqual([])
    expect(result.text).toBe('no-lines')
  })

  it('fails a path source that does not exist instead of recognizing an empty image', async () => {
    const missing = path.join(appRoot, 'missing.png')

    await expect(
      ocr.recognize({ modelPaths: MODEL_PATHS, source: { kind: 'path', imagePath: missing } })
    ).rejects.toThrow(/ENOENT/)
  })
})
