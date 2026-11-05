import { describe, expect, it, vi } from 'vitest'

import { fileMutationService } from '../FileMutationService'
import type * as types from '../types'
import { validatePath } from '../types'

vi.mock('../types', async (importOriginal) => {
  const original = await importOriginal<typeof types>()
  return { ...original, validatePath: vi.fn() }
})

const mockedValidatePath = vi.mocked(validatePath)

describe('FileMutationService', () => {
  it('re-queues under the new canonical key when the target is retargeted while queued', async () => {
    // 'link' resolves to /ws/A before queuing and to /ws/B at the in-section
    // re-validation (symlink retargeted during the wait). Running on B while
    // holding only A's mutex would bypass B's own queue, so the call must
    // re-queue under B's key, behind mutations that targeted B directly.
    const linkResolutions = ['/ws/A', '/ws/B']
    mockedValidatePath.mockImplementation((requestedPath: string) => {
      if (requestedPath === 'link') {
        return Promise.resolve(linkResolutions.length > 0 ? linkResolutions.shift()! : '/ws/B')
      }
      return Promise.resolve(requestedPath)
    })

    const events: string[] = []
    let directStarted!: () => void
    const directStartedGate = new Promise<void>((resolve) => {
      directStarted = resolve
    })
    let releaseDirect!: () => void
    const directGate = new Promise<void>((resolve) => {
      releaseDirect = resolve
    })

    // Holds B's queue until released.
    const directOnB = fileMutationService.run('/ws/B', '/ws', async (validPath) => {
      events.push(`direct-start:${validPath}`)
      directStarted()
      await directGate
      events.push('direct-end')
    })
    await directStartedGate

    // Queued on A; by its in-section re-validation the link points at B.
    const retargeted = fileMutationService.run('link', '/ws', async (validPath) => {
      events.push(`retargeted:${validPath}`)
    })

    // Let the retargeted call re-queue on B before releasing the direct call.
    await new Promise((resolve) => setTimeout(resolve, 20))
    releaseDirect()
    await Promise.all([directOnB, retargeted])

    expect(events).toEqual(['direct-start:/ws/B', 'direct-end', 'retargeted:/ws/B'])
  })
})
