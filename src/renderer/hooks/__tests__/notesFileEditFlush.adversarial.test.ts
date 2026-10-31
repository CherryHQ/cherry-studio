import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  flushAllNotesEdits,
  lockNotesEditsForRelocation,
  registerNotesEditFlush,
  registerNotesEditPreFlush,
  resetNotesEditFlushTrackingForTests,
  runStructuralNotesFilesystemWrite,
  trackPendingNotesImagePaste,
  unlockNotesEditsForRelocation,
  waitForStructuralNotesWritesToSettle
} from '../notesFileEditFlush'

afterEach(() => {
  resetNotesEditFlushTrackingForTests()
  unlockNotesEditsForRelocation()
})

describe('notesFileEditFlush adversarial ordering', () => {
  it('COUNTEREXAMPLE: a paste that starts during a pre-flush callback is not awaited before the drains run', async () => {
    unlockNotesEditsForRelocation()
    resetNotesEditFlushTrackingForTests()

    let pasteFinished = false
    registerNotesEditPreFlush(() => {
      trackPendingNotesImagePaste(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            pasteFinished = true
            resolve()
          }, 20)
        })
      )
    })
    const drain = vi.fn().mockResolvedValue(undefined)
    registerNotesEditFlush(drain)

    await flushAllNotesEdits()
    expect(drain).toHaveBeenCalledOnce()
    // The drain was allowed to proceed while the late paste was still in flight.
    expect(pasteFinished).toBe(false)
  })

  it('COUNTEREXAMPLE: a structural write that starts after settle but before the lock is not blocked', async () => {
    unlockNotesEditsForRelocation()
    resetNotesEditFlushTrackingForTests()

    await waitForStructuralNotesWritesToSettle()

    let ran = false
    const write = runStructuralNotesFilesystemWrite(
      () => undefined,
      async () => {
        ran = true
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    )
    // The relocation lock engages only after the write has already started.
    lockNotesEditsForRelocation()
    await write
    expect(ran).toBe(true)
    unlockNotesEditsForRelocation()
  })

  it('rejects the whole flush when a pre-flush throws, so the relocation aborts before any drain', async () => {
    unlockNotesEditsForRelocation()
    resetNotesEditFlushTrackingForTests()

    registerNotesEditPreFlush(() => {
      throw new Error('editor read exploded')
    })
    const drain = vi.fn().mockResolvedValue(undefined)
    registerNotesEditFlush(drain)

    await expect(flushAllNotesEdits()).rejects.toThrow('editor read exploded')
    expect(drain).not.toHaveBeenCalled()
  })

  it('a failing drain rejects even when other drains succeed, and later flushes retry', async () => {
    unlockNotesEditsForRelocation()
    resetNotesEditFlushTrackingForTests()

    let failing = true
    registerNotesEditFlush(vi.fn().mockResolvedValue(undefined))
    registerNotesEditFlush(
      vi.fn().mockImplementation(async () => {
        if (failing) throw new Error('still conflicted')
      })
    )

    await expect(flushAllNotesEdits()).rejects.toThrow('still conflicted')
    failing = false
    await expect(flushAllNotesEdits()).resolves.toBeUndefined()
  })
})
