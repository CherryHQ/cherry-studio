import { describe, expect, it } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesRelocationErrorCodes } from '@shared/ipc/errors/notesRelocation'

import { withNotesRelocationExclusive } from '../notesRelocationSession'

describe('withNotesRelocationExclusive', () => {
  it('rejects a second migration while the first is in progress', async () => {
    let releaseFirst: (() => void) | undefined
    const firstStarted = withNotesRelocationExclusive(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )

    const second = withNotesRelocationExclusive(async () => undefined)

    await expect(second).rejects.toMatchObject({
      code: notesRelocationErrorCodes.NOTES_RELOCATION_IN_PROGRESS
    })
    await expect(second).rejects.toBeInstanceOf(IpcError)

    releaseFirst?.()
    await firstStarted
  })
})
