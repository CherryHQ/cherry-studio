import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BundleFile, ModelBundle } from '../../catalog/types'
import type * as DownloadEngineModule from '../downloadEngine'

const { streamToFileVerified, fetchTextVerified, writeFileAtomic } = vi.hoisted(() => ({
  streamToFileVerified: vi.fn(),
  fetchTextVerified: vi.fn(),
  writeFileAtomic: vi.fn()
}))

// The mirror-fallback loop and the verified writes have their own tests; keep the real
// loop here so URL order is what this file actually asserts.
vi.mock('../downloadEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof DownloadEngineModule>()),
  streamToFileVerified,
  fetchTextVerified,
  writeFileAtomic
}))

const { downloadBundleFiles } = await import('../bundleDownload')

const WEIGHTS: BundleFile = {
  key: 'weights',
  relPath: 'onnx/model.onnx',
  repo: 'org/weights',
  remoteFile: 'model.onnx',
  sha256: 'a'.repeat(64),
  minBytes: 10,
  weight: 99
}

const DICT: BundleFile = {
  key: 'dictionary',
  relPath: 'dict.txt',
  repo: 'org/rec',
  remoteFile: 'inference.yml',
  sha256: 'b'.repeat(64),
  minBytes: 10,
  weight: 1,
  derivation: 'paddle_dict_from_inference_yml'
}

const BUNDLE: ModelBundle = {
  id: 'pp-ocrv6-medium',
  capability: 'ocr',
  installDirKey: 'feature.ocr.paddleocr',
  requires: ['onnxruntime-node'],
  files: [WEIGHTS, DICT]
}

const INSTALL_DIR = '/install'

function options(overrides: Partial<Parameters<typeof downloadBundleFiles>[2]> = {}) {
  return {
    sourceOrder: ['huggingface', 'hf-mirror', 'modelscope'] as const,
    signal: new AbortController().signal,
    installDir: INSTALL_DIR,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  streamToFileVerified.mockResolvedValue(undefined)
  fetchTextVerified.mockResolvedValue(
    ['PostProcess:', '  name: CTCLabelDecode', '  character_dict:', '  - a'].join('\n')
  )
  writeFileAtomic.mockResolvedValue(undefined)
})

describe('downloadBundleFiles', () => {
  it('streams a plain file to its install path from the first requested source', async () => {
    await downloadBundleFiles(BUNDLE, [WEIGHTS], options())

    expect(streamToFileVerified).toHaveBeenCalledWith(
      'https://huggingface.co/org/weights/resolve/main/model.onnx',
      path.join(INSTALL_DIR, 'onnx/model.onnx'),
      expect.objectContaining({ sha256: WEIGHTS.sha256 })
    )
  })

  it('honors an explicit ModelScope-first source order', async () => {
    await downloadBundleFiles(BUNDLE, [WEIGHTS], options({ sourceOrder: ['modelscope', 'huggingface'] }))

    expect(streamToFileVerified.mock.calls[0][0]).toContain('modelscope.cn')
  })

  it('walks every remaining mirror when the first requested source is unreachable', async () => {
    // The region signal is a guess — a proxied China user reads as overseas and gets
    // HuggingFace, which they often cannot reach. The China-hosted mirrors must still get
    // their turn, and a repo only one of them carries must still be reachable.
    streamToFileVerified.mockRejectedValueOnce(new Error('fetch failed'))
    streamToFileVerified.mockRejectedValueOnce(new Error('fetch failed'))

    await downloadBundleFiles(BUNDLE, [WEIGHTS], options())

    expect(streamToFileVerified.mock.calls[1][0]).toContain('hf-mirror.com')
    expect(streamToFileVerified.mock.calls[2][0]).toContain('modelscope.cn')
  })

  it('writes a derived file from its transformed bytes, not the fetched ones', async () => {
    await downloadBundleFiles(BUNDLE, [DICT], options())

    // Streaming the fetched inference.yml to disk would write something that is not the
    // artifact ppu-paddle-ocr loads.
    expect(streamToFileVerified).not.toHaveBeenCalled()
    expect(fetchTextVerified).toHaveBeenCalledWith(
      'https://huggingface.co/org/rec/resolve/main/inference.yml',
      expect.objectContaining({ sha256: DICT.sha256 })
    )
    expect(writeFileAtomic).toHaveBeenCalledWith(path.join(INSTALL_DIR, 'dict.txt'), '\na\n')
  })

  it('reports progress weighted by file size, ending at a full bar', async () => {
    // Equal-share progress would hold the bar at 50% through a 99MB file and then sweep
    // the last 50% through a 1MB one.
    streamToFileVerified.mockImplementation(async (_url, _dest, opts) => opts.onProgress?.(1))
    const fractions: number[] = []

    await downloadBundleFiles(BUNDLE, [WEIGHTS, DICT], options({ onProgress: (f) => fractions.push(f) }))

    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(fractions).toContain(0.99)
    expect(fractions.at(-1)).toBe(1)
  })
})
