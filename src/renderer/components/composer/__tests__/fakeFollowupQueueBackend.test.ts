import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { beforeEach, describe, expect, it } from 'vitest'

import { installFakeFollowupQueueBackend } from './fakeFollowupQueueBackend'

function triggerFor(method: string, path: string) {
  const shell = (mockUseMutation as unknown as (m: string, p: string) => { trigger: (args: never) => Promise<never> })(
    method,
    path
  )
  return shell.trigger as unknown as (args: unknown) => Promise<{
    id: string
    claimed: boolean
  } | void>
}

const draft = (text: string) => ({ text, tokens: [] })
const payload = (text: string) => ({ text, userMessageParts: [] })

describe('fakeFollowupQueueBackend', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    installFakeFollowupQueueBackend()
  })

  it('keeps claim:head on the display head after a reorder', async () => {
    const post = triggerFor('POST', '/followup-queues')
    const first = (await post({ body: { scopeKey: 's', draft: draft('a'), payload: payload('a') } })) as { id: string }
    const second = (await post({ body: { scopeKey: 's', draft: draft('b'), payload: payload('b') } })) as {
      id: string
    }

    // Move the second row first, the way the hook's reorder builds its moves.
    const reorder = triggerFor('PATCH', '/followup-queues/order:batch')
    await reorder({ body: { moves: [{ id: first.id, anchor: { after: second.id } }] } })

    const claimHead = triggerFor('POST', '/followup-queues/claim:head')
    await expect(claimHead({ body: { scopeKey: 's' } })).resolves.toMatchObject({
      claimed: true,
      id: second.id
    })
  })
})
