import { describe, expect, it } from 'vitest'

import {
  lockNotesEditsForRelocation,
  runStructuralNotesFilesystemWrite,
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
