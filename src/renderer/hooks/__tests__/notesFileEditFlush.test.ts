import { describe, expect, it, vi } from 'vitest'

import {
  flushAllNotesEdits,
  lockNotesEditsForRelocation,
  registerNotesEditFlush,
  runStructuralNotesFilesystemWrite,
  trackDepartingNotesFileWrite,
  unlockNotesEditsForRelocation,
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
