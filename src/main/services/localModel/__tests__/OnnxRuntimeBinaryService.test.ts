import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FAKE_PLATFORM = 'linux'
const FAKE_ARCH = 'x64'
const FAKE_TARBALL_CONTENT = Buffer.from('fake-onnxruntime-node-tarball-fixture')
// sha256 of FAKE_TARBALL_CONTENT — precomputed with:
// printf 'fake-onnxruntime-node-tarball-fixture' | shasum -a 256
const FAKE_TARBALL_SHA256 = '5576b1313abe30c692fdc1b79cb6763292e7c69664dacb4a33906e98616da392'

const { extractMock, isInChina } = vi.hoisted(() => ({
  extractMock: vi.fn(),
  isInChina: vi.fn()
}))

let toolchainDir: string

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGetPath = result.application.getPath.getMockImplementation()!
  result.application.getPath.mockImplementation((key: string, filename?: string) => {
    if (key === 'feature.onnxruntime.binary') return filename ? path.join(toolchainDir, filename) : toolchainDir
    return originalGetPath(key, filename)
  })
  return result
})

vi.mock('@main/ai/inference/localModelCatalog', () => ({
  ONNXRUNTIME_NODE_VERSION: '1.24.3',
  ONNXRUNTIME_TARBALL_SHA256: FAKE_TARBALL_SHA256,
  ONNXRUNTIME_LEAVES: {
    [FAKE_PLATFORM]: {
      [FAKE_ARCH]: { binding: 'onnxruntime_binding.node', sharedLibs: ['libonnxruntime.so.1'] }
    }
  }
}))

vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina } }))

// Not testing tar's own parsing (verified separately against the real package) — simulate
// what a real extraction would produce: the leaf's binding + shared libs under `cwd`.
vi.mock('tar', () => ({ extract: extractMock }))

const { onnxRuntimeBinaryService } = await import('../OnnxRuntimeBinaryService')

/** A `net.fetch` Response shell streaming `content`. */
function tarballResponse(content: Buffer) {
  return {
    ok: true,
    headers: { get: (h: string) => (h === 'content-length' ? String(content.length) : null) },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(content)
        controller.close()
      }
    })
  }
}

describe('OnnxRuntimeBinaryService', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  beforeEach(() => {
    vi.clearAllMocks()
    toolchainDir = mkdtempSync(path.join(tmpdir(), 'onnxruntime-binary-test-'))
    Object.defineProperty(process, 'platform', { value: FAKE_PLATFORM, writable: true })
    Object.defineProperty(process, 'arch', { value: FAKE_ARCH, writable: true })
    isInChina.mockResolvedValue(false)
    vi.mocked(net.fetch).mockImplementation((async () =>
      tarballResponse(FAKE_TARBALL_CONTENT)) as unknown as typeof net.fetch)
    // Simulate a successful extraction: write the leaf files a real `tar.extract` would.
    extractMock.mockImplementation(async ({ cwd }: { cwd: string }) => {
      const fs = await import('node:fs/promises')
      await fs.mkdir(cwd, { recursive: true })
      await fs.writeFile(path.join(cwd, 'onnxruntime_binding.node'), 'binding')
      await fs.writeFile(path.join(cwd, 'libonnxruntime.so.1'), 'sharedlib')
    })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
    rmSync(toolchainDir, { recursive: true, force: true })
  })

  it('reports not ready before anything is downloaded', () => {
    expect(onnxRuntimeBinaryService.isReady()).toBe(false)
  })

  it('reports ready on an unsupported platform/arch (no catalog leaf)', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'x64' }) // absent from the mocked catalog

    expect(onnxRuntimeBinaryService.isReady()).toBe(true)
  })

  it('bindingPath() resolves under the leaf directory for the current platform/arch', () => {
    expect(onnxRuntimeBinaryService.bindingPath()).toBe(
      path.join(toolchainDir, 'napi-v6', FAKE_PLATFORM, FAKE_ARCH, 'onnxruntime_binding.node')
    )
  })

  it('downloads, verifies, extracts, and installs the binary; isReady() becomes true', async () => {
    const controller = new AbortController()

    await onnxRuntimeBinaryService.ensure(controller.signal)

    expect(net.fetch).toHaveBeenCalledTimes(1)
    expect(extractMock).toHaveBeenCalledTimes(1)
    expect(onnxRuntimeBinaryService.isReady()).toBe(true)
    // The staging dir must not survive the download — not even as an empty shell.
    expect(existsSync(path.join(toolchainDir, '.tmp'))).toBe(false)
  })

  it('does not download again once already ready', async () => {
    const controller = new AbortController()
    await onnxRuntimeBinaryService.ensure(controller.signal)
    vi.mocked(net.fetch).mockClear()

    await onnxRuntimeBinaryService.ensure(controller.signal)

    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('coalesces concurrent callers into a single download', async () => {
    const controller = new AbortController()

    await Promise.all([
      onnxRuntimeBinaryService.ensure(controller.signal),
      onnxRuntimeBinaryService.ensure(controller.signal)
    ])

    expect(net.fetch).toHaveBeenCalledTimes(1)
    expect(extractMock).toHaveBeenCalledTimes(1)
  })

  it('tries the region-default mirror first: npmjs when not in China', async () => {
    isInChina.mockResolvedValue(false)

    await onnxRuntimeBinaryService.ensure(new AbortController().signal)

    expect(vi.mocked(net.fetch).mock.calls[0][0]).toContain('registry.npmjs.org')
  })

  it('tries npmmirror.com first when the region signal reports China', async () => {
    isInChina.mockResolvedValue(true)

    await onnxRuntimeBinaryService.ensure(new AbortController().signal)

    expect(vi.mocked(net.fetch).mock.calls[0][0]).toContain('registry.npmmirror.com')
  })

  it('falls back to the second mirror when the first fails', async () => {
    isInChina.mockResolvedValue(false)
    vi.mocked(net.fetch)
      .mockImplementationOnce((async () => {
        throw new Error('network down')
      }) as unknown as typeof net.fetch)
      .mockImplementationOnce((async () => tarballResponse(FAKE_TARBALL_CONTENT)) as unknown as typeof net.fetch)

    await onnxRuntimeBinaryService.ensure(new AbortController().signal)

    expect(net.fetch).toHaveBeenCalledTimes(2)
    expect(onnxRuntimeBinaryService.isReady()).toBe(true)
  })

  it('rejects and leaves the binary not installed when the tarball sha256 does not match', async () => {
    vi.mocked(net.fetch).mockImplementation((async () =>
      tarballResponse(Buffer.from('tampered content'))) as unknown as typeof net.fetch)

    await expect(onnxRuntimeBinaryService.ensure(new AbortController().signal)).rejects.toThrow('sha256 mismatch')

    expect(extractMock).not.toHaveBeenCalled()
    expect(onnxRuntimeBinaryService.isReady()).toBe(false)
    // A failed download must not leave the staging dir behind either.
    expect(existsSync(path.join(toolchainDir, '.tmp'))).toBe(false)
  })

  describe('removeIfUnused', () => {
    it('keeps the binary when the sibling feature still needs it', async () => {
      await onnxRuntimeBinaryService.ensure(new AbortController().signal)

      await onnxRuntimeBinaryService.removeIfUnused(true)

      expect(onnxRuntimeBinaryService.isReady()).toBe(true)
    })

    it('deletes the binary once no feature needs it anymore', async () => {
      await onnxRuntimeBinaryService.ensure(new AbortController().signal)

      await onnxRuntimeBinaryService.removeIfUnused(false)

      expect(onnxRuntimeBinaryService.isReady()).toBe(false)
    })

    it('is a no-op when the binary was never downloaded', async () => {
      await expect(onnxRuntimeBinaryService.removeIfUnused(false)).resolves.toBeUndefined()
    })
  })
})
