import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CatalogModule from '../../catalog/catalog'

const FAKE_PLATFORM = 'linux'
const FAKE_ARCH = 'x64'
// sha256 of FAKE_TARBALL_CONTENT (see FIXTURE_ARTIFACT below) — precomputed with:
// printf 'fake-onnxruntime-node-tarball-fixture' | shasum -a 256
const FAKE_TARBALL_CONTENT = Buffer.from('fake-onnxruntime-node-tarball-fixture')

/** A fixture artifact pinned to the fake platform, so the suite is independent of the real
 * catalog's checksum and of the machine it runs on. */
const { extractMock, FIXTURE_ARTIFACT } = vi.hoisted(() => ({
  extractMock: vi.fn(),
  FIXTURE_ARTIFACT: {
    id: 'onnxruntime-node' as const,
    packageName: 'onnxruntime-node',
    version: '1.25.1',
    tarballSha256: '5576b1313abe30c692fdc1b79cb6763292e7c69664dacb4a33906e98616da392',
    installDirKey: 'feature.onnxruntime.binary' as const,
    platforms: {
      'linux-x64': {
        tarballPrefix: 'package/bin/napi-v6/linux/x64/',
        installSubdir: 'napi-v6/linux/x64',
        entryFile: 'onnxruntime_binding.node',
        supportFiles: ['libonnxruntime.so.1']
      }
    }
  }
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

// Not testing tar's own parsing (verified separately against the real package) — simulate
// what a real extraction would produce: the platform's files under `cwd`.
vi.mock('tar', () => ({ extract: extractMock }))

vi.mock('../../catalog/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogModule>()
  return { ...actual, getSharedArtifact: () => FIXTURE_ARTIFACT }
})

const { localModelStorageService } = await import('../../installation/LocalModelStorageService')
const { artifactEntryPath, artifactRegistryOrder, isArtifactSupported } = await import('../tarballArtifact')

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

const ensure = (
  signal = new AbortController().signal,
  registryOrder: ['npmjs' | 'npmmirror', ...Array<'npmjs' | 'npmmirror'>] = ['npmjs', 'npmmirror']
) => localModelStorageService.ensureArtifact('onnxruntime-node', signal, undefined, registryOrder)
const isReady = () => localModelStorageService.isArtifactReady('onnxruntime-node')

describe('shared artifact acquisition', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  beforeEach(() => {
    vi.clearAllMocks()
    toolchainDir = mkdtempSync(path.join(tmpdir(), 'onnxruntime-binary-test-'))
    Object.defineProperty(process, 'platform', { value: FAKE_PLATFORM, writable: true })
    Object.defineProperty(process, 'arch', { value: FAKE_ARCH, writable: true })
    vi.mocked(net.fetch).mockImplementation((async () =>
      tarballResponse(FAKE_TARBALL_CONTENT)) as unknown as typeof net.fetch)
    // Simulate a successful extraction: write the files a real `tar.extract` would.
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
    expect(isReady()).toBe(false)
  })

  it('reports ready on a platform the artifact ships nothing for', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'x64' }) // absent from the fixture matrix

    expect(isArtifactSupported(FIXTURE_ARTIFACT)).toBe(false)
    expect(isReady()).toBe(true)
  })

  it('resolves the entry file under the platform install dir', () => {
    expect(artifactEntryPath(FIXTURE_ARTIFACT)).toBe(
      path.join(toolchainDir, 'napi-v6', FAKE_PLATFORM, FAKE_ARCH, 'onnxruntime_binding.node')
    )
  })

  it('downloads, verifies, extracts, and installs the binary; it becomes ready', async () => {
    await ensure()

    expect(net.fetch).toHaveBeenCalledTimes(1)
    expect(extractMock).toHaveBeenCalledTimes(1)
    expect(isReady()).toBe(true)
    // The staging dir must not survive the download — not even as an empty shell.
    expect(existsSync(path.join(toolchainDir, '.tmp'))).toBe(false)
  })

  it('does not download again once already ready', async () => {
    await ensure()
    vi.mocked(net.fetch).mockClear()

    await ensure()

    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('coalesces concurrent callers into a single download', async () => {
    const { signal } = new AbortController()

    await Promise.all([ensure(signal), ensure(signal)])

    expect(net.fetch).toHaveBeenCalledTimes(1)
    expect(extractMock).toHaveBeenCalledTimes(1)
  })

  it('tries npmjs first when requested', async () => {
    await ensure()

    expect(vi.mocked(net.fetch).mock.calls[0][0]).toContain('registry.npmjs.org')
  })

  it('tries npmmirror.com first when requested', async () => {
    await ensure(new AbortController().signal, ['npmmirror', 'npmjs'])

    expect(vi.mocked(net.fetch).mock.calls[0][0]).toContain('registry.npmmirror.com')
  })

  it('maps source preference to registry order once', () => {
    expect(artifactRegistryOrder('china-first')).toEqual(['npmmirror', 'npmjs'])
    expect(artifactRegistryOrder('global-first')).toEqual(['npmjs', 'npmmirror'])
  })

  it('falls back to the second mirror when the first fails', async () => {
    vi.mocked(net.fetch)
      .mockImplementationOnce((async () => {
        throw new Error('network down')
      }) as unknown as typeof net.fetch)
      .mockImplementationOnce((async () => tarballResponse(FAKE_TARBALL_CONTENT)) as unknown as typeof net.fetch)

    await ensure()

    expect(net.fetch).toHaveBeenCalledTimes(2)
    expect(isReady()).toBe(true)
  })

  it('falls back to the second mirror when the first serves a tarball that fails the checksum', async () => {
    // A reachable-but-wrong mirror (stale cache, error page, interception) must not be
    // terminal — the checksum is part of the attempt, so the next mirror still gets its turn.
    vi.mocked(net.fetch)
      .mockImplementationOnce((async () =>
        tarballResponse(Buffer.from('tampered content'))) as unknown as typeof net.fetch)
      .mockImplementationOnce((async () => tarballResponse(FAKE_TARBALL_CONTENT)) as unknown as typeof net.fetch)

    await ensure()

    expect(net.fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(net.fetch).mock.calls[1][0]).toContain('registry.npmmirror.com')
    expect(isReady()).toBe(true)
  })

  it('rejects and installs nothing when every mirror fails the checksum', async () => {
    vi.mocked(net.fetch).mockImplementation((async () =>
      tarballResponse(Buffer.from('tampered content'))) as unknown as typeof net.fetch)

    await expect(ensure()).rejects.toThrow('sha256 mismatch')

    expect(extractMock).not.toHaveBeenCalled()
    expect(isReady()).toBe(false)
    // A failed download must not leave the staging dir behind either.
    expect(existsSync(path.join(toolchainDir, '.tmp'))).toBe(false)
  })

  describe('removeArtifactIfUnused', () => {
    it('deletes the installed binary', async () => {
      await ensure()

      await localModelStorageService.removeArtifactIfUnused('onnxruntime-node')

      expect(isReady()).toBe(false)
    })

    it('is a no-op when the binary was never downloaded', async () => {
      await expect(localModelStorageService.removeArtifactIfUnused('onnxruntime-node')).resolves.toBe(true)
    })
  })
})
