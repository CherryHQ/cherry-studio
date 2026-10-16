import { describe, expect, it, vi } from 'vitest'

import {
  areNotesEditsLockedForRelocation,
  flushAllNotesEdits,
  getNotesRelocationBarrierEpoch,
  hasPendingNotesImagePastes,
  lockNotesEditsForRelocation,
  registerNotesEditFlush,
  registerNotesEditPreFlush,
  releaseOneNotesRelocationEditLock,
  runStructuralNotesFilesystemWrite,
  trackDepartingNotesFileWrite,
  trackPendingNotesImagePaste,
  unlockNotesEditsForRelocation,
  waitForPendingNotesImagePastes,
  waitForStructuralNotesWritesToSettle
} from '../notesFileEditFlush'

describe('notesFileEditFlush structural writes', () => {
  it('waits for in-flight structural writes before settling', async () => {
    unlockNotesEditsForRelocation()

    let settled = false
    const writePromise = runStructuralNotesFilesystemWrite(
      () => undefined,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    )

    const settlePromise = waitForStructuralNotesWritesToSettle().then(() => {
      settled = true
    })

    await Promise.all([writePromise, settlePromise])
    expect(settled).toBe(true)
  })

  it('waits for departing file writes during flush', async () => {
    unlockNotesEditsForRelocation()

    let departingFinished = false
    const departing = new Promise<void>((resolve) => {
      setTimeout(() => {
        departingFinished = true
        resolve()
      }, 20)
    })
    trackDepartingNotesFileWrite(departing)

    const flush = vi.fn().mockResolvedValue(undefined)
    registerNotesEditFlush(flush)

    await flushAllNotesEdits()
    expect(departingFinished).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
  })

  it('reports pending image pastes until the tracked operation settles', async () => {
    unlockNotesEditsForRelocation()

    let resolvePaste!: () => void
    const paste = trackPendingNotesImagePaste(
      new Promise<void>((resolve) => {
        resolvePaste = resolve
      })
    )
    expect(hasPendingNotesImagePastes()).toBe(true)

    resolvePaste()
    await paste
    await waitForPendingNotesImagePastes()
    expect(hasPendingNotesImagePastes()).toBe(false)
  })

  it('waits for pending image pastes during flush', async () => {
    unlockNotesEditsForRelocation()

    let pasteFinished = false
    const paste = trackPendingNotesImagePaste(
      new Promise<void>((resolve) => {
        setTimeout(() => {
          pasteFinished = true
          resolve()
        }, 20)
      })
    )

    const flush = vi.fn().mockResolvedValue(undefined)
    registerNotesEditFlush(flush)

    await flushAllNotesEdits()
    await paste
    expect(pasteFinished).toBe(true)
    expect(flush).toHaveBeenCalledOnce()
  })

  it('runs pre-flush hooks before registered flush callbacks', async () => {
    unlockNotesEditsForRelocation()

    const order: string[] = []
    registerNotesEditPreFlush(async () => {
      order.push('pre')
    })
    registerNotesEditFlush(async () => {
      order.push('flush')
    })

    await flushAllNotesEdits()
    expect(order).toEqual(['pre', 'flush'])
  })

  it('bumps the barrier epoch when relocation edits unlock', () => {
    unlockNotesEditsForRelocation()
    lockNotesEditsForRelocation()
    const before = getNotesRelocationBarrierEpoch()
    unlockNotesEditsForRelocation()
    expect(getNotesRelocationBarrierEpoch()).toBe(before + 1)
  })

  it('releases only the flush-acquired lock without clearing an active relocation barrier', () => {
    unlockNotesEditsForRelocation()
    lockNotesEditsForRelocation()
    lockNotesEditsForRelocation()
    releaseOneNotesRelocationEditLock()
    expect(areNotesEditsLockedForRelocation()).toBe(true)
    unlockNotesEditsForRelocation()
    expect(areNotesEditsLockedForRelocation()).toBe(false)
  })

  it('blocks new structural writes while relocation edits are locked', async () => {
    unlockNotesEditsForRelocation()
    lockNotesEditsForRelocation()

    let ran = false
    await runStructuralNotesFilesystemWrite(
      () => undefined,
      async () => {
        ran = true
      }
    )

    expect(ran).toBe(false)
    unlockNotesEditsForRelocation()
  })
})

describe('notesFileEditFlush failed departing writes', () => {
  it('keeps rejecting repeated flushes after a departing save fails', async () => {
    vi.resetModules()
    const flushModule = await import('../notesFileEditFlush')
    const failed = Promise.reject(new Error('departing save failed'))
    failed.catch(() => undefined)
    flushModule.trackDepartingNotesFileWrite(failed)

    await expect(flushModule.flushAllNotesEdits()).rejects.toThrow('departing save failed')
    // A retried migration must not proceed past the unresolved failure.
    await expect(flushModule.flushAllNotesEdits()).rejects.toThrow('departing save failed')
  })

  it('drops a departing write once it has succeeded', async () => {
    vi.resetModules()
    const flushModule = await import('../notesFileEditFlush')
    const departing = vi.fn(async () => undefined)
    flushModule.trackDepartingNotesFileWrite(departing())

    await expect(flushModule.flushAllNotesEdits()).resolves.toBeUndefined()
    await expect(flushModule.flushAllNotesEdits()).resolves.toBeUndefined()
  })
})
