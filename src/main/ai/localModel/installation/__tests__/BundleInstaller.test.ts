import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CatalogTypesModule from '../../catalog/types'

let rootDir: string

const { artifactInstalled, installArtifact, downloadBundleFiles } = vi.hoisted(() => ({
  artifactInstalled: vi.fn(),
  installArtifact: vi.fn(),
  downloadBundleFiles: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGetPath = result.application.getPath.getMockImplementation()!
  result.application.getPath.mockImplementation((key: string, filename?: string) => {
    if (key === 'feature.embedding.models') return filename ? path.join(rootDir, filename) : rootDir
    return originalGetPath(key, filename)
  })
  return result
})

// Only the shared-artifact leaf is stubbed: the storage service above it — path resolution and
// the on-disk scan that decides every status — stays real, against a temp directory.
vi.mock('../../acquisition/tarballArtifact', () => ({
  artifactRegistryOrder: (preference: 'china-first' | 'global-first') =>
    preference === 'china-first' ? ['npmmirror', 'npmjs'] : ['npmjs', 'npmmirror'],
  isArtifactInstalled: artifactInstalled,
  installArtifact,
  artifactEntryPath: () => '/binding.node',
  removeArtifact: vi.fn()
}))

vi.mock('../../acquisition/bundleDownload', () => ({ downloadBundleFiles }))

// Pin the artifact support matrix to a supported platform; unsupported inference has its own test.
vi.mock('../../catalog/types', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogTypesModule>()
  return { ...actual, currentPlatformKey: () => 'darwin-arm64' }
})

const { BundleInstaller } = await import('../BundleInstaller')

const FILES: CatalogTypesModule.BundleFile[] = [
  {
    key: 'config',
    relPath: 'config.json',
    repo: 'r',
    remoteFile: 'config.json',
    sha256: 'a'.repeat(64),
    minBytes: 10,
    weight: 1
  },
  {
    key: 'weights',
    relPath: 'onnx/model.onnx',
    repo: 'r',
    remoteFile: 'onnx/model.onnx',
    sha256: 'b'.repeat(64),
    minBytes: 10,
    weight: 99
  }
]

const BUNDLE: CatalogTypesModule.ModelBundle = {
  id: 'qwen3-embedding-0.6b',
  capability: 'embedding',
  installDirKey: 'feature.embedding.models',
  installSubdir: 'org/model',
  requires: ['onnxruntime-node'],
  files: FILES
}

const INSTALL_SUBDIR = 'org/model'
const GLOBAL_FIRST = async () => 'global-first' as const

let terminateRuntimeThen: ReturnType<typeof vi.fn>
let acquireRemovalGuard: ReturnType<typeof vi.fn>
let releaseRemovalGuard: ReturnType<typeof vi.fn>
let afterRemove: ReturnType<typeof vi.fn>
let publishStatus: ReturnType<typeof vi.fn>
let finalizeSharedArtifacts: ReturnType<typeof vi.fn>
let manager: InstanceType<typeof BundleInstaller>

function newManager() {
  return new BundleInstaller(
    BUNDLE,
    {
      acquireRemovalGuard,
      terminateRuntimeThen,
      afterRemove
    },
    publishStatus,
    finalizeSharedArtifacts
  )
}

function writeFiles(...relPaths: string[]): void {
  for (const relPath of relPaths) {
    const target = path.join(rootDir, INSTALL_SUBDIR, relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, Buffer.alloc(20))
  }
}

function installComplete(): void {
  writeFiles('config.json', 'onnx/model.onnx')
}

function statusUpdates(): Array<{ status: string; percent: number; errorCode?: string }> {
  return publishStatus.mock.calls.map(([snapshot]) => snapshot)
}

beforeEach(() => {
  vi.clearAllMocks()
  rootDir = mkdtempSync(path.join(tmpdir(), 'bundle-installer-test-'))
  releaseRemovalGuard = vi.fn()
  acquireRemovalGuard = vi.fn(() => releaseRemovalGuard)
  afterRemove = vi.fn(async () => {})
  publishStatus = vi.fn()
  finalizeSharedArtifacts = vi.fn(async () => {})
  terminateRuntimeThen = vi.fn(async (after: () => Promise<unknown>) => after())
  artifactInstalled.mockReturnValue(true)
  installArtifact.mockResolvedValue(undefined)
  downloadBundleFiles.mockImplementation(async () => installComplete())
  manager = newManager()
})

afterEach(() => rmSync(rootDir, { recursive: true, force: true }))

describe('status', () => {
  it('reports not_downloaded when nothing is on disk', () => {
    expect(manager.getStatus()).toBe('not_downloaded')
  })

  it('reports ready once every file and the shared runtime are present', () => {
    installComplete()

    expect(manager.getStatus()).toBe('ready')
  })

  it('offers a download rather than an error when only the shared runtime is missing', () => {
    // A ~40MB runtime repair the user can act on — reporting `error` here left the card
    // with a failure it could not clear while a complete ~614MB model sat on disk.
    installComplete()
    artifactInstalled.mockReturnValue(false)

    expect(manager.getStatus()).toBe('not_downloaded')
  })

  it('reports why a partial install failed via the incomplete_cache code', () => {
    writeFiles('config.json')

    expect(manager.getStatusInfo()).toEqual({ status: 'error', errorCode: 'incomplete_cache' })
  })

  it('logs an incomplete install once rather than on every status poll', () => {
    writeFiles('config.json')

    expect(manager.getStatus()).toBe('error')
    expect(manager.getStatus()).toBe('error')

    expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'local model files are incomplete',
      expect.objectContaining({ missing: ['onnx/model.onnx'] })
    )
  })
})

describe('download', () => {
  it('fetches only the files that are missing', async () => {
    // The whole point of scanning disk: a half-finished install must not re-fetch the
    // ~614MB of weights that already landed.
    writeFiles('onnx/model.onnx')

    await expect(manager.download(GLOBAL_FIRST)).resolves.toBe('ready')

    expect(downloadBundleFiles).toHaveBeenCalledWith(
      BUNDLE,
      [expect.objectContaining({ relPath: 'config.json' })],
      expect.objectContaining({ installDir: path.join(rootDir, INSTALL_SUBDIR) })
    )
  })

  it('never moves the bar backwards across the runtime→files boundary', async () => {
    artifactInstalled.mockReturnValue(false)
    installArtifact.mockImplementation(async (_artifact, _signal, onProgress?: (f: number) => void) => {
      onProgress?.(0.5)
      onProgress?.(1)
      artifactInstalled.mockReturnValue(true)
    })
    downloadBundleFiles.mockImplementation(async (_bundle, _files, options) => {
      options.onProgress?.(0)
      options.onProgress?.(0.5)
      installComplete()
    })

    await expect(manager.download(GLOBAL_FIRST)).resolves.toBe('ready')

    // Two phases on one scale — a phase restarting at 0 is what snapped the bar back.
    const percents = statusUpdates().map((payload) => payload.percent)
    expect(percents).toEqual([...percents].sort((a, b) => a - b))
    expect(percents.at(-1)).toBe(100)
    expect(statusUpdates().at(-1)?.status).toBe('ready')
  })

  it('includes the current progress in a status snapshot while downloading', async () => {
    downloadBundleFiles.mockImplementation(
      (_bundle, _files, options: { signal: AbortSignal; onProgress?: (fraction: number) => void }) =>
        new Promise<void>((_resolve, reject) => {
          options.onProgress?.(0.4)
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
    )

    const download = manager.download(GLOBAL_FIRST)
    await vi.waitFor(() => expect(manager.getStatusSnapshot()).toEqual({ status: 'downloading', percent: 40 }))

    const cancellation = manager.cancel()
    await expect(download).resolves.toBe('cancelled')
    await expect(cancellation).resolves.toBeUndefined()
  })

  it('coalesces concurrent callers into a single download', async () => {
    // The settings card and the knowledge-base entry hit the same manager; two downloads
    // would write the same files twice and double the bytes fetched.
    const [first, second] = await Promise.all([manager.download(GLOBAL_FIRST), manager.download(GLOBAL_FIRST)])

    expect(first).toBe('ready')
    expect(second).toBe('ready')
    expect(downloadBundleFiles).toHaveBeenCalledTimes(1)
  })

  it('reports a cancel as cancelled rather than as a failure', async () => {
    downloadBundleFiles.mockImplementation((_bundle, _files, options: { signal: AbortSignal }) => {
      void manager.cancel()
      return Promise.reject(options.signal.reason ?? new Error('aborted'))
    })

    await expect(manager.download(GLOBAL_FIRST)).resolves.toBe('cancelled')

    expect(statusUpdates().some((payload) => payload.status === 'error')).toBe(false)
    expect(statusUpdates().at(-1)).toMatchObject({ status: 'not_downloaded', percent: 0 })
    expect(manager.getStatus()).toBe('not_downloaded')
  })

  it('keeps the committed bundle ready when cancellation arrives after the final write', async () => {
    downloadBundleFiles.mockImplementation(async () => {
      installComplete()
      void manager.cancel()
    })

    await expect(manager.download(GLOBAL_FIRST)).resolves.toBe('ready')

    expect(finalizeSharedArtifacts).not.toHaveBeenCalled()
    expect(statusUpdates().at(-1)).toEqual({ status: 'ready', percent: 100 })
    expect(manager.getStatus()).toBe('ready')
  })

  it('can cancel while the mirror region decision is pending', async () => {
    let resolveRegion: ((value: 'china-first') => void) | undefined
    const regionDecision = new Promise<'china-first'>((resolve) => {
      resolveRegion = resolve
    })

    const download = manager.download(() => regionDecision)
    expect(statusUpdates()).toEqual([{ status: 'downloading', percent: 0 }])
    const cancellation = manager.cancel()
    await expect(download).resolves.toBe('cancelled')
    await expect(cancellation).resolves.toBeUndefined()
    expect(downloadBundleFiles).not.toHaveBeenCalled()
    resolveRegion?.('china-first')
  })

  it('keeps a failed attempt draining until cleanup finishes, then starts a fresh retry', async () => {
    let finishCleanup: (() => void) | undefined
    downloadBundleFiles.mockRejectedValueOnce(new Error('download failed'))
    finalizeSharedArtifacts.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve
        })
    )

    const first = manager.download(GLOBAL_FIRST)
    void first.catch(() => {})
    await vi.waitFor(() => expect(finishCleanup).toBeDefined())
    expect(manager.getStatus()).toBe('downloading')
    expect(statusUpdates().some((payload) => payload.status === 'error')).toBe(false)

    const retry = manager.download(GLOBAL_FIRST)
    expect(downloadBundleFiles).toHaveBeenCalledOnce()
    finishCleanup?.()

    await expect(first).rejects.toThrow('download failed')
    await expect(retry).resolves.toBe('ready')
    expect(downloadBundleFiles).toHaveBeenCalledTimes(2)
    expect(statusUpdates().at(-1)?.status).toBe('ready')
  })

  it('starts a fresh retry after a cancelled attempt finishes cleanup', async () => {
    let finishCleanup: (() => void) | undefined
    downloadBundleFiles.mockImplementationOnce(
      (_bundle, _files, options: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
    )
    finalizeSharedArtifacts.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve
        })
    )

    const first = manager.download(GLOBAL_FIRST)
    await vi.waitFor(() => expect(downloadBundleFiles).toHaveBeenCalledOnce())
    const cancellation = manager.cancel()
    const retry = manager.download(GLOBAL_FIRST)
    await vi.waitFor(() => expect(finishCleanup).toBeDefined())
    expect(downloadBundleFiles).toHaveBeenCalledOnce()

    finishCleanup?.()
    await expect(first).resolves.toBe('cancelled')
    await expect(cancellation).resolves.toBeUndefined()
    await expect(retry).resolves.toBe('ready')
    expect(downloadBundleFiles).toHaveBeenCalledTimes(2)
  })

  it('keeps a complete model on disk when the runtime-only repair fails', async () => {
    // The runtime is fetched before the weights are touched, so a ~40MB registry failure
    // must not cost the ~614MB already downloaded.
    installComplete()
    artifactInstalled.mockReturnValue(false)
    installArtifact.mockRejectedValueOnce(new Error('every registry mirror failed'))

    await expect(manager.download(GLOBAL_FIRST)).rejects.toThrow('every registry mirror failed')

    expect(downloadBundleFiles).not.toHaveBeenCalled()
    expect(readdirSync(path.join(rootDir, INSTALL_SUBDIR))).toContain('config.json')
  })

  it('leaves those files usable on the next run once the runtime is repaired', async () => {
    installComplete()
    artifactInstalled.mockReturnValue(false)
    installArtifact.mockRejectedValueOnce(new Error('every registry mirror failed'))
    await expect(manager.download(GLOBAL_FIRST)).rejects.toThrow()
    expect(manager.getStatusInfo()).toEqual({ status: 'error', errorCode: 'download_failed' })

    // A fresh manager stands in for an app restart, which clears the in-memory
    // last-failure flag that otherwise pins the card to `error` for the rest of the run.
    artifactInstalled.mockReturnValue(true)

    expect(newManager().getStatus()).toBe('ready')
  })
})

describe('remove', () => {
  it('keeps the files when the capability refuses removal', async () => {
    acquireRemovalGuard.mockReturnValueOnce(undefined)
    installComplete()

    await expect(manager.remove()).resolves.toEqual({ removed: false })

    expect(terminateRuntimeThen).not.toHaveBeenCalled()
    expect(manager.getStatus()).toBe('ready')
  })

  it('releases the runtime before deleting, and deletes the bundle root whole', async () => {
    installComplete()

    await expect(manager.remove()).resolves.toEqual({ removed: true })

    // The inference process holds the weights open; release it before unlinking on Windows.
    expect(terminateRuntimeThen).toHaveBeenCalledOnce()
    expect(afterRemove).toHaveBeenCalledOnce()
    // The whole root, so no empty `org/` parent chain survives the removal.
    expect(existsSync(rootDir)).toBe(false)
    expect(releaseRemovalGuard).toHaveBeenCalledOnce()
    expect(statusUpdates().at(-1)).toMatchObject({ status: 'not_downloaded', percent: 0 })
  })

  it('cancels and settles an active download before deleting its files', async () => {
    downloadBundleFiles.mockImplementation(
      (_bundle, _files, options: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
    )
    const download = manager.download(GLOBAL_FIRST)
    await vi.waitFor(() => expect(downloadBundleFiles).toHaveBeenCalledOnce())

    const removal = manager.remove()

    await expect(download).resolves.toBe('cancelled')
    await expect(removal).resolves.toEqual({ removed: true })
    expect(existsSync(rootDir)).toBe(false)
  })

  it('holds the removal guard until the deletion actually completes', async () => {
    // Releasing on the synchronous return would let a re-download start writing files
    // the pending deletion is still walking.
    let finishDeletion: (() => void) | undefined
    terminateRuntimeThen.mockImplementationOnce(
      (after: () => Promise<unknown>) =>
        new Promise((resolve) => {
          finishDeletion = () => resolve(after())
        })
    )

    const pending = manager.remove()
    await vi.waitFor(() => expect(finishDeletion).toBeDefined())
    expect(releaseRemovalGuard).not.toHaveBeenCalled()
    await expect(manager.download(GLOBAL_FIRST)).rejects.toThrow(/being removed/)

    finishDeletion?.()
    await expect(pending).resolves.toEqual({ removed: true })
    expect(releaseRemovalGuard).toHaveBeenCalledOnce()
  })

  it('releases the removal guard when the deletion fails', async () => {
    terminateRuntimeThen.mockRejectedValueOnce(new Error('disk busy'))

    await expect(manager.remove()).rejects.toThrow('disk busy')

    expect(afterRemove).not.toHaveBeenCalled()
    expect(releaseRemovalGuard).toHaveBeenCalledOnce()
  })

  it('runs dependent preference cleanup only after the files are deleted', async () => {
    installComplete()
    const order: string[] = []
    terminateRuntimeThen.mockImplementationOnce(async (after: () => Promise<unknown>) => {
      await after()
      order.push('deleted')
    })
    afterRemove.mockImplementationOnce(async () => {
      order.push('preferences')
    })
    finalizeSharedArtifacts.mockImplementationOnce(async () => {
      order.push('artifacts')
    })
    publishStatus.mockImplementationOnce(() => {
      order.push('status')
    })

    await manager.remove()

    expect(order).toEqual(['deleted', 'preferences', 'artifacts', 'status'])
  })
})
