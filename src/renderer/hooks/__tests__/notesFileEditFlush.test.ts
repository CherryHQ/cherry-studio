import { describe, expect, it, vi } from 'vitest'

import {
  flushAllNotesEdits,
  hasPendingNotesImagePastes,
  lockNotesEditsForRelocation,
  registerNotesEditFlush,
  registerNotesEditPreFlush,
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
