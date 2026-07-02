import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it } from 'vitest'

import { DirectoryTreeManager } from '../DirectoryTreeManager'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('DirectoryTreeManager profile activation', () => {
  it('bumps the dispose generation on deactivate and does not reset it on activate', async () => {
    const svc = new DirectoryTreeManager()
    const genBefore = svc['disposeGeneration']

    await svc.onProfileDeactivate()
    // Teardown advanced the generation so a builder that resolves later bails.
    expect(svc['disposeGeneration']).toBe(genBefore + 1)

    svc.onProfileActivate()
    // Activate must NOT reset the generation — a boolean that flips back to false
    // would reopen the window for a stale in-flight scan to register a cross-profile
    // watcher (the round-3 finding). The generation only ever moves forward.
    expect(svc['disposeGeneration']).toBe(genBefore + 1)
  })
})
