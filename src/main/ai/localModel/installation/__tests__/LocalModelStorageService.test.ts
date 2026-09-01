import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    // Something is occupying the destination path (a live worker's open handle does the
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
    await expect(first).rejects.toThrow('first caller cancelled')

    const late = ensureArtifact(lateController.signal)
    expect(installArtifact).toHaveBeenCalledOnce()

    finishDrain?.()
    await expect(late).resolves.toBeUndefined()
    expect(installArtifact).toHaveBeenCalledTimes(2)
  })
})

describe('shared artifact removal coordination', () => {
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

  it('grants a reservation after a failed removal has settled', async () => {
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
