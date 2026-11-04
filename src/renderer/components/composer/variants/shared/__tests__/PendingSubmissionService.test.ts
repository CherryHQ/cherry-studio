import { describe, expect, it } from 'vitest'

import { pendingSubmissionService } from '../PendingSubmissionService'

describe('PendingSubmissionService', () => {
  it('shares scope ownership across consumers and releases only the settled scope', async () => {
    const otherConsumer = (await import('../PendingSubmissionService')).pendingSubmissionService
    expect(otherConsumer).toBe(pendingSubmissionService)
    pendingSubmissionService.acquire('pending-scope-a')
    pendingSubmissionService.acquire('pending-scope-b')
    expect(otherConsumer.isPending('pending-scope-a')).toBe(true)
    otherConsumer.release('pending-scope-a')
    expect(pendingSubmissionService.isPending('pending-scope-a')).toBe(false)
    expect(pendingSubmissionService.isPending('pending-scope-b')).toBe(true)
    pendingSubmissionService.acquire('pending-scope-a')
    expect(otherConsumer.isPending('pending-scope-a')).toBe(true)
    pendingSubmissionService.release('pending-scope-a')
    pendingSubmissionService.release('pending-scope-b')
  })
})
