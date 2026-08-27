import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BundleFile, ModelBundle } from '../types'

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

// Only the shared-artifact leaf is stubbed: the registry above it — path resolution and
// the on-disk scan that decides every status — stays real, against a temp directory.
vi.mock('../../acquisition/tarballArtifact', () => ({
  isArtifactInstalled: artifactInstalled,
  installArtifact,
  artifactEntryPath: () => '/binding.node',
  removeArtifact: vi.fn()
}))

vi.mock('../../acquisition/bundleDownload', () => ({ downloadBundleFiles }))

// Pin to a supported platform so status and download are deterministic regardless of the
// machine this runs on (the Intel Mac gate has its own test).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

const { application } = await import('@application')
const { BundleInstallManager } = await import('../BundleInstallManager')

const FILES: BundleFile[] = [
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

const BUNDLE: ModelBundle = {
  id: 'qwen3-embedding-0.6b',
  capability: 'embedding',
  installDirKey: 'feature.embedding.models',
  installSubdir: 'org/model',
  requires: ['onnxruntime-node'],
  files: FILES
}

const INSTALL_SUBDIR = 'org/model'

let terminateRuntimeThen: ReturnType<typeof vi.fn>
let acquireRemovalGuard: ReturnType<typeof vi.fn>
let releaseRemovalGuard: ReturnType<typeof vi.fn>
let afterRemove: ReturnType<typeof vi.fn>
let manager: InstanceType<typeof BundleInstallManager>

function newManager() {
  return new BundleInstallManager(BUNDLE, {
    acquireRemovalGuard,
    terminateRuntimeThen,
    afterRemove
  })
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

function broadcasts(): Array<{ status: string; percent: number; errorCode?: string }> {
  return vi
    .mocked(application.get('IpcApiService').broadcast)
    .mock.calls.filter(([channel]) => channel === 'local_model.download_progress')
    .map(([, payload]) => payload as { status: string; percent: number; errorCode?: string })
}

beforeEach(() => {
  vi.clearAllMocks()
  rootDir = mkdtempSync(path.join(tmpdir(), 'bundle-install-manager-test-'))
  releaseRemovalGuard = vi.fn()
  acquireRemovalGuard = vi.fn(() => releaseRemovalGuard)
  afterRemove = vi.fn(async () => {})
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

    await expect(manager.download()).resolves.toBe('ready')

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

    await expect(manager.download()).resolves.toBe('ready')

    // Two phases on one scale — a phase restarting at 0 is what snapped the bar back.
    const percents = broadcasts().map((payload) => payload.percent)
    expect(percents).toEqual([...percents].sort((a, b) => a - b))
    expect(percents.at(-1)).toBe(100)
    expect(broadcasts().at(-1)?.status).toBe('ready')
  })

  it('coalesces concurrent callers into a single download', async () => {
    // The settings card and the knowledge-base entry hit the same manager; two downloads
    // would write the same files twice and double the bytes fetched.
    const [first, second] = await Promise.all([manager.download(), manager.download()])

    expect(first).toBe('ready')
    expect(second).toBe('ready')
    expect(downloadBundleFiles).toHaveBeenCalledTimes(1)
  })

  it('reports a cancel as cancelled rather than as a failure', async () => {
    downloadBundleFiles.mockImplementation((_bundle, _files, options: { signal: AbortSignal }) => {
      manager.cancel()
      return Promise.reject(options.signal.reason ?? new Error('aborted'))
    })

    await expect(manager.download()).resolves.toBe('cancelled')

    expect(broadcasts().some((payload) => payload.status === 'error')).toBe(false)
    expect(broadcasts().at(-1)).toMatchObject({ status: 'not_downloaded', percent: 0 })
    expect(manager.getStatus()).toBe('not_downloaded')
  })

  it('keeps a complete model on disk when the runtime-only repair fails', async () => {
    // The runtime is fetched before the weights are touched, so a ~40MB registry failure
    // must not cost the ~614MB already downloaded.
    installComplete()
    artifactInstalled.mockReturnValue(false)
    installArtifact.mockRejectedValueOnce(new Error('every registry mirror failed'))

    await expect(manager.download()).rejects.toThrow('every registry mirror failed')

    expect(downloadBundleFiles).not.toHaveBeenCalled()
    expect(readdirSync(path.join(rootDir, INSTALL_SUBDIR))).toContain('config.json')
  })

  it('leaves those files usable on the next run once the runtime is repaired', async () => {
    installComplete()
    artifactInstalled.mockReturnValue(false)
    installArtifact.mockRejectedValueOnce(new Error('every registry mirror failed'))
    await expect(manager.download()).rejects.toThrow()
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

    // The worker holds the weights open — release it first or the unlink fails on Windows.
    expect(terminateRuntimeThen).toHaveBeenCalledOnce()
    expect(afterRemove).toHaveBeenCalledOnce()
    // The whole root, so no empty `org/` parent chain survives the removal.
    expect(existsSync(rootDir)).toBe(false)
    expect(releaseRemovalGuard).toHaveBeenCalledOnce()
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

    finishDeletion?.()
    await expect(pending).resolves.toEqual({ removed: true })
    expect(releaseRemovalGuard).toHaveBeenCalledOnce()
  })

  it('releases the removal guard when the deletion fails', async () => {
    terminateRuntimeThen.mockRejectedValueOnce(new Error('disk busy'))

    await expect(manager.remove()).rejects.toThrow('disk busy')

    expect(releaseRemovalGuard).toHaveBeenCalledOnce()
  })
})
