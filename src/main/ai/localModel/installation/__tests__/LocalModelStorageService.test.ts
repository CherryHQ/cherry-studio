import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelBundle } from '../../catalog/types'

let installDir: string

const { artifactInstalled, installArtifact, removeArtifact } = vi.hoisted(() => ({
  artifactInstalled: vi.fn(() => false),
  installArtifact: vi.fn(),
  removeArtifact: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGetPath = result.application.getPath.getMockImplementation()!
  result.application.getPath.mockImplementation((key: string, filename?: string) => {
    if (key === 'feature.ocr.paddleocr') return filename ? path.join(installDir, filename) : installDir
    return originalGetPath(key, filename)
  })
  return result
})

vi.mock('../../acquisition/tarballArtifact', () => ({
  artifactEntryPath: () => '/binding.node',
  artifactStagingDir: () => path.join(installDir, 'runtime', '.tmp'),
  installArtifact,
  isArtifactInstalled: artifactInstalled,
  removeArtifact
}))

const { localModelStorageService } = await import('../LocalModelStorageService')

const BUNDLE: ModelBundle = {
  id: 'pp-ocrv6-medium',
  capability: 'ocr',
  installDirKey: 'feature.ocr.paddleocr',
  requires: ['onnxruntime-node'],
  files: [
    { key: 'a', relPath: 'a.onnx', repo: 'r', remoteFile: 'a', sha256: 'x'.repeat(64), minBytes: 10, weight: 1 },
    { key: 'b', relPath: 'nested/b.onnx', repo: 'r', remoteFile: 'b', sha256: 'y'.repeat(64), minBytes: 10, weight: 1 }
  ]
}

const REGISTRY_ORDER = ['npmjs', 'npmmirror'] as const

function ensureArtifact(signal: AbortSignal): Promise<void> {
  return localModelStorageService.ensureArtifact('onnxruntime-node', signal, undefined, REGISTRY_ORDER)
}

/** An install an earlier release wrote under a now-superseded subdirectory. */
const LEGACY_BUNDLE: ModelBundle = { ...BUNDLE, installSubdir: 'model', legacyInstallSubdir: 'model/master' }

function writeBundleFile(relPath: string, size: number): void {
  const target = path.join(installDir, relPath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, Buffer.alloc(size))
}

beforeEach(() => {
  vi.clearAllMocks()
  artifactInstalled.mockReset().mockReturnValue(false)
  installArtifact.mockReset().mockResolvedValue(undefined)
  removeArtifact.mockReset().mockResolvedValue(undefined)
  installDir = mkdtempSync(path.join(tmpdir(), 'local-model-storage-test-'))
})

afterEach(() => rmSync(installDir, { recursive: true, force: true }))

describe('scanBundleFiles', () => {
  it('reports not_installed when nothing is on disk', () => {
    expect(localModelStorageService.scanBundleFiles(BUNDLE)).toEqual({ status: 'not_installed' })
  })

  it('reports installed once every file is present and large enough', () => {
    writeBundleFile('a.onnx', 20)
    writeBundleFile('nested/b.onnx', 20)

    expect(localModelStorageService.scanBundleFiles(BUNDLE)).toEqual({ status: 'installed' })
  })

  it('reports which files are missing when only some arrived', () => {
    writeBundleFile('a.onnx', 20)

    expect(localModelStorageService.scanBundleFiles(BUNDLE)).toEqual({
      status: 'incomplete',
      missingFiles: ['nested/b.onnx']
    })
  })

  it('treats a truncated file as missing rather than installed', () => {
    writeBundleFile('a.onnx', 20)
    // A killed download before checksums existed could leave a stub behind; counting it
    // as installed would surface as an unreadable model at inference time instead.
    writeBundleFile('nested/b.onnx', 1)

    expect(localModelStorageService.scanBundleFiles(BUNDLE)).toEqual({
      status: 'incomplete',
      missingFiles: ['nested/b.onnx']
    })
  })

  it('treats a directory sitting where a file belongs as missing', () => {
    writeBundleFile('a.onnx', 20)
    mkdirSync(path.join(installDir, 'nested', 'b.onnx'), { recursive: true })

    expect(localModelStorageService.scanBundleFiles(BUNDLE).status).toBe('incomplete')
  })
})

describe('sweepStaleDownloads', () => {
  it('removes atomic-write partials beside bundle files and the runtime staging dir, nothing else', async () => {
    writeBundleFile('a.onnx', 20)
    writeBundleFile('a.onnx.tmp-0f5f1e6e-3d8a-4a44-9b1c-9a1f6e0d8b11', 5)
    writeBundleFile('nested/b.onnx.tmp-1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b', 5)
    writeBundleFile('nested/notes.txt', 5)
    writeBundleFile('runtime/.tmp/onnxruntime-node-1.0.0.tgz.tmp-2c3d4e5f-6071-4829-9bac-1d2e3f4a5b6c', 5)

    await localModelStorageService.sweepStaleDownloads(BUNDLE)

    expect(existsSync(path.join(installDir, 'a.onnx'))).toBe(true)
    expect(existsSync(path.join(installDir, 'nested', 'notes.txt'))).toBe(true)
    expect(readdirSync(installDir).filter((entry) => entry.includes('.tmp-'))).toEqual([])
    expect(readdirSync(path.join(installDir, 'nested')).filter((entry) => entry.includes('.tmp-'))).toEqual([])
    expect(existsSync(path.join(installDir, 'runtime', '.tmp'))).toBe(false)
  })

  it('is a no-op for a bundle whose directories were never created', async () => {
    await expect(localModelStorageService.sweepStaleDownloads(BUNDLE)).resolves.toBeUndefined()
  })
})

describe('resolveInstalledDir', () => {
  it('returns the current layout and leaves a stale legacy directory alone', () => {
    writeBundleFile('model/a.onnx', 20)
    writeBundleFile('model/nested/b.onnx', 20)
    writeBundleFile('model/master/a.onnx', 20)

    expect(localModelStorageService.resolveInstalledDir(LEGACY_BUNDLE)).toBe(path.join(installDir, 'model'))
    expect(existsSync(path.join(installDir, 'model/master/a.onnx'))).toBe(true)
  })

  it('lifts a legacy-only install into the current layout instead of re-downloading it', () => {
    writeBundleFile('model/master/a.onnx', 20)
    writeBundleFile('model/master/nested/b.onnx', 20)

    expect(localModelStorageService.resolveInstalledDir(LEGACY_BUNDLE)).toBe(path.join(installDir, 'model'))
    expect(existsSync(path.join(installDir, 'model/nested/b.onnx'))).toBe(true)
    expect(existsSync(path.join(installDir, 'model/master'))).toBe(false)
  })

  it('reports a legacy-only install as installed, so no re-download is offered', () => {
    writeBundleFile('model/master/a.onnx', 20)
    writeBundleFile('model/master/nested/b.onnx', 20)

    expect(localModelStorageService.scanBundleFiles(LEGACY_BUNDLE)).toEqual({ status: 'installed' })
  })

  it('serves the legacy install in place when the lift cannot complete', () => {
    // Something is occupying the destination path (a live process's open handle does the
    // same on Windows). Losing a complete model over a failed move would be the worse
    // outcome, so the legacy copy stays usable and a later run retries.
    writeBundleFile('model/master/a.onnx', 20)
    writeBundleFile('model/master/nested/b.onnx', 20)
    mkdirSync(path.join(installDir, 'model', 'a.onnx', 'blocker'), { recursive: true })

    expect(localModelStorageService.resolveInstalledDir(LEGACY_BUNDLE)).toBe(path.join(installDir, 'model/master'))
    expect(existsSync(path.join(installDir, 'model/master/a.onnx'))).toBe(true)
    expect(localModelStorageService.pendingBundleFiles(LEGACY_BUNDLE)).toEqual([])
  })

  it('keeps the legacy install complete when a later file cannot be moved', () => {
    // The dangerous ordering: the first file moves, the second does not. Leaving it that
    // way would split a complete install across both layouts, so it reads as incomplete
    // and re-downloads weights that never left the disk.
    writeBundleFile('model/master/a.onnx', 20)
    writeBundleFile('model/master/nested/b.onnx', 20)
    mkdirSync(path.join(installDir, 'model', 'nested', 'b.onnx', 'blocker'), { recursive: true })

    expect(localModelStorageService.resolveInstalledDir(LEGACY_BUNDLE)).toBe(path.join(installDir, 'model/master'))
    expect(existsSync(path.join(installDir, 'model/master/a.onnx'))).toBe(true)
    expect(existsSync(path.join(installDir, 'model/master/nested/b.onnx'))).toBe(true)
    expect(localModelStorageService.scanBundleFiles(LEGACY_BUNDLE)).toEqual({ status: 'installed' })
  })

  it('returns null when neither layout holds a complete install', () => {
    writeBundleFile('model/master/a.onnx', 20)

    expect(localModelStorageService.resolveInstalledDir(LEGACY_BUNDLE)).toBeNull()
  })
})

describe('shared artifact installation', () => {
  it('lets one caller cancel without aborting another caller awaiting the same install', async () => {
    let finishInstall: (() => void) | undefined
    let sharedSignal: AbortSignal | undefined
    installArtifact.mockImplementation(
      (_artifact, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          sharedSignal = signal
          finishInstall = resolve
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = ensureArtifact(firstController.signal)
    const second = ensureArtifact(secondController.signal)
    firstController.abort(new Error('first caller cancelled'))

    await expect(first).rejects.toThrow('first caller cancelled')
    expect(sharedSignal?.aborted).toBe(false)

    finishInstall?.()
    await expect(second).resolves.toBeUndefined()
    expect(installArtifact).toHaveBeenCalledOnce()
  })

  it('starts a fresh install for a caller arriving while an aborted install drains', async () => {
    let finishDrain: (() => void) | undefined
    installArtifact
      .mockImplementationOnce(
        (_artifact, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                finishDrain = () => reject(signal.reason)
              },
              { once: true }
            )
          })
      )
      .mockResolvedValueOnce(undefined)
    const firstController = new AbortController()
    const lateController = new AbortController()

    const first = ensureArtifact(firstController.signal)
    await vi.waitFor(() => expect(installArtifact).toHaveBeenCalledOnce())
    firstController.abort(new Error('first caller cancelled'))
    await vi.waitFor(() => expect(finishDrain).toBeDefined())

    const late = ensureArtifact(lateController.signal)
    expect(installArtifact).toHaveBeenCalledOnce()

    finishDrain?.()
    await expect(first).rejects.toThrow('first caller cancelled')
    await expect(late).resolves.toBeUndefined()
    expect(installArtifact).toHaveBeenCalledTimes(2)
  })

  it('does not release the last caller until the install it cancelled has drained', async () => {
    let finishDrain: (() => void) | undefined
    installArtifact.mockImplementationOnce(
      (_artifact, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              finishDrain = () => reject(signal.reason)
            },
            { once: true }
          )
        })
    )
    const controller = new AbortController()

    const only = ensureArtifact(controller.signal)
    await vi.waitFor(() => expect(installArtifact).toHaveBeenCalledOnce())
    let settled = false
    only.catch(() => {
      settled = true
    })
    controller.abort(new Error('cancelled'))
    await vi.waitFor(() => expect(finishDrain).toBeDefined())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    finishDrain?.()
    await expect(only).rejects.toThrow('cancelled')
  })
})

describe('shared artifact removal coordination', () => {
  it('admits a reservation before a later removal can observe the artifact as unused', async () => {
    const reservation = localModelStorageService.reserveArtifacts(['onnxruntime-node'], new AbortController().signal)
    const removal = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')

    const release = await reservation
    await expect(removal).resolves.toBe(false)
    expect(removeArtifact).not.toHaveBeenCalled()
    release()
  })

  it('does not remove an artifact reserved by a bundle attempt', async () => {
    const controller = new AbortController()
    const release = await localModelStorageService.reserveArtifacts(['onnxruntime-node'], controller.signal)

    await expect(localModelStorageService.removeArtifactIfUnused('onnxruntime-node')).resolves.toBe(false)
    expect(removeArtifact).not.toHaveBeenCalled()

    release()
    await expect(localModelStorageService.removeArtifactIfUnused('onnxruntime-node')).resolves.toBe(true)
    expect(removeArtifact).toHaveBeenCalledOnce()
  })

  it('waits for an active removal before granting a new reservation', async () => {
    let finishRemoval: (() => void) | undefined
    removeArtifact.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRemoval = resolve
        })
    )
    const removal = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')
    await vi.waitFor(() => expect(finishRemoval).toBeDefined())

    let acquired = false
    const reservation = localModelStorageService
      .reserveArtifacts(['onnxruntime-node'], new AbortController().signal)
      .then((release) => {
        acquired = true
        return release
      })
    await Promise.resolve()
    expect(acquired).toBe(false)

    finishRemoval?.()
    await expect(removal).resolves.toBe(true)
    const release = await reservation
    expect(acquired).toBe(true)
    release()
  })

  it('coalesces concurrent removals into one artifact deletion', async () => {
    let finishRemoval: (() => void) | undefined
    removeArtifact.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRemoval = resolve
        })
    )

    const first = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')
    const second = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')
    await vi.waitFor(() => expect(finishRemoval).toBeDefined())

    expect(removeArtifact).toHaveBeenCalledOnce()
    finishRemoval?.()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })

  it('waits for an aborted install to drain before deleting the artifact', async () => {
    let finishInstall: (() => void) | undefined
    installArtifact.mockImplementationOnce(
      (_artifact, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              finishInstall = () => reject(signal.reason)
            },
            { once: true }
          )
        })
    )
    const install = ensureArtifact(new AbortController().signal)
    await vi.waitFor(() => expect(installArtifact).toHaveBeenCalledOnce())

    const removal = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')
    await vi.waitFor(() => expect(finishInstall).toBeDefined())
    expect(removeArtifact).not.toHaveBeenCalled()

    finishInstall?.()
    await expect(install).rejects.toThrow('shared artifact removed')
    await expect(removal).resolves.toBe(true)
    expect(removeArtifact).toHaveBeenCalledOnce()
  })

  it('can cancel while waiting for an active removal', async () => {
    let finishRemoval: (() => void) | undefined
    removeArtifact.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRemoval = resolve
        })
    )
    const removal = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')
    await vi.waitFor(() => expect(finishRemoval).toBeDefined())
    const controller = new AbortController()

    const reservation = localModelStorageService.reserveArtifacts(['onnxruntime-node'], controller.signal)
    controller.abort(new Error('bundle download cancelled'))

    await expect(reservation).rejects.toThrow('bundle download cancelled')
    finishRemoval?.()
    await expect(removal).resolves.toBe(true)
  })

  it('allows reservation and removal to retry after a failed deletion', async () => {
    let failRemoval: (() => void) | undefined
    removeArtifact.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failRemoval = () => reject(new Error('disk busy'))
        })
    )
    const removal = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')
    void removal.catch(() => {})
    await vi.waitFor(() => expect(failRemoval).toBeDefined())
    const reservation = localModelStorageService.reserveArtifacts(['onnxruntime-node'], new AbortController().signal)

    failRemoval?.()

    await expect(removal).rejects.toThrow('disk busy')
    const release = await reservation
    release()

    await expect(localModelStorageService.removeArtifactIfUnused('onnxruntime-node')).resolves.toBe(true)
    expect(removeArtifact).toHaveBeenCalledTimes(2)
  })

  it('does not start an install while the artifact directory is being removed', async () => {
    let finishRemoval: (() => void) | undefined
    removeArtifact.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRemoval = resolve
        })
    )
    const removal = localModelStorageService.removeArtifactIfUnused('onnxruntime-node')
    await vi.waitFor(() => expect(finishRemoval).toBeDefined())

    const install = ensureArtifact(new AbortController().signal)
    expect(installArtifact).not.toHaveBeenCalled()

    finishRemoval?.()
    await removal
    await install
    expect(installArtifact).toHaveBeenCalledOnce()
  })
})
