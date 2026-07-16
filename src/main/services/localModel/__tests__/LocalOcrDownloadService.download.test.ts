import type * as NodeFs from 'node:fs'
import { Writable } from 'node:stream'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina: vi.fn().mockResolvedValue(false) } }))

// onnxruntime binary presence is a separate concern (see OnnxRuntimeBinaryService.test.ts) —
// stub it as already-ready so these tests only exercise the OCR weight/dictionary lifecycle.
vi.mock('@main/services/localModel/OnnxRuntimeBinaryService', () => ({
  onnxRuntimeBinaryService: {
    isReady: vi.fn(() => true),
    ensure: vi.fn(async () => undefined)
  }
}))

const { createWriteStream, mkdir, rename, writeFile, rm } = vi.hoisted(() => ({
  createWriteStream: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Pin to a supported platform so download() is deterministic regardless of the
// machine this runs on (see LocalModelDownloadService.darwinX64.test.ts for the gate).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

// The download streams weights to disk; stub the fs writes so the byte-counting
// (min-size guard) runs without touching the real filesystem.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const patched = { ...actual, createWriteStream, promises: { ...actual.promises, mkdir, rename, writeFile, rm } }
  return { ...patched, default: patched }
})

const { localOcrDownloadService } = await import('../LocalOcrDownloadService')
const { regionService } = await import('@main/services/RegionService')

const DEFAULT_KEY = 'feature.file_processing.default_image_to_text'
const VALID_WEIGHT_BYTES = 1_000_001 // just over the 1MB min-size guard
const DICT_YML = [
  'PostProcess:',
  '  name: CTCLabelDecode',
  '  character_dict:',
  "  - '!'",
  '  - a',
  // Padding (a YAML comment, ignored by the parser) so the fixture clears the
  // dictionary download's own 10_000-byte min-size guard, like a real inference.yml.
  `  # ${'x'.repeat(10_100)}`
].join('\n')

/** A `net.fetch` Response shell streaming `byteLength` zero bytes. */
function weightResponse(byteLength: number) {
  return {
    ok: true,
    headers: { get: (h: string) => (h === 'content-length' ? String(byteLength) : null) },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(byteLength))
        controller.close()
      }
    })
  }
}

/** The dictionary is fetched as the recognition model's inference.yml. */
function dictResponse() {
  return { ok: true, text: async () => DICT_YML }
}

describe('LocalOcrDownloadService.download — mirror fallback + min-size guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    // afterEach's restoreAllMocks reverts vi.fn() mocks (not just vi.spyOn ones) to their
    // construction-time no-op, so the module-level mockResolvedValue(false) only survives
    // the first test unless it's re-armed here.
    vi.mocked(regionService.isInChina).mockResolvedValue(false)
    mkdir.mockResolvedValue(undefined)
    rename.mockResolvedValue(undefined)
    writeFile.mockResolvedValue(undefined)
    rm.mockResolvedValue(undefined)
    // Drain each download into a black hole; the min-size guard only needs the byte count.
    createWriteStream.mockImplementation(() => new Writable({ write: (_chunk, _encoding, cb) => cb() }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads every file and promotes local OCR to the default image-to-text engine', async () => {
    vi.mocked(net.fetch).mockImplementation((async (url: string) =>
      url.endsWith('.yml') ? dictResponse() : weightResponse(VALID_WEIGHT_BYTES)) as unknown as typeof net.fetch)

    await localOcrDownloadService.download()

    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBe('local-paddleocr')
  })

  it('does not clobber an engine the user already explicitly chose', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(DEFAULT_KEY, 'mistral')
    vi.mocked(net.fetch).mockImplementation((async (url: string) =>
      url.endsWith('.yml') ? dictResponse() : weightResponse(VALID_WEIGHT_BYTES)) as unknown as typeof net.fetch)

    await localOcrDownloadService.download()

    // The model still downloads successfully — it's just not silently made the
    // active default when the user already picked something else.
    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBe('mistral')
  })

  it('falls back to the next mirror when the region-default mirror fails', async () => {
    const urls: string[] = []
    vi.mocked(net.fetch).mockImplementation((async (url: string) => {
      urls.push(url)
      if (url.startsWith('https://huggingface.co')) throw new Error('network down')
      return url.endsWith('.yml') ? dictResponse() : weightResponse(VALID_WEIGHT_BYTES)
    }) as unknown as typeof net.fetch)

    await localOcrDownloadService.download()

    // Not in China → HuggingFace first (fails) → ModelScope (succeeds) for every file.
    expect(urls.some((u) => u.startsWith('https://huggingface.co'))).toBe(true)
    expect(urls.some((u) => u.startsWith('https://www.modelscope.cn'))).toBe(true)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBe('local-paddleocr')
  })

  it('rejects a too-small download (LFS pointer / error page) after exhausting mirrors', async () => {
    vi.mocked(net.fetch).mockImplementation((async () => weightResponse(200)) as unknown as typeof net.fetch)

    await expect(localOcrDownloadService.download()).rejects.toThrow()

    // Never promoted — the guard rejected before any weights landed.
    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).not.toBe('local-paddleocr')
  })

  it('rejects a too-small dictionary response (LFS pointer / truncated / error page) after exhausting mirrors', async () => {
    vi.mocked(net.fetch).mockImplementation((async (url: string) =>
      url.endsWith('.yml')
        ? { ok: true, text: async () => 'PostProcess:\n  character_dict:\n  - a' }
        : weightResponse(VALID_WEIGHT_BYTES)) as unknown as typeof net.fetch)

    await expect(localOcrDownloadService.download()).rejects.toThrow()

    // A truncated-but-parseable yml must not silently produce an incomplete dictionary.
    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).not.toBe('local-paddleocr')
  })
})
