import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { beforeEach, describe, expect, it } from 'vitest'

import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { FOLLOWUP_QUEUE_LIMIT } from '@shared/data/types/followupQueue'

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

  it('rejects enqueues past the per-scope limit like production', async () => {
    const post = triggerFor('POST', '/followup-queues')
    for (let i = 0; i < FOLLOWUP_QUEUE_LIMIT; i++) {
      await post({ body: { scopeKey: 's', draft: draft(`a${i}`), payload: payload(`a${i}`) } })
    }

    const error = await post({
      body: { scopeKey: 's', draft: draft('over'), payload: payload('over') }
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DataApiError)
    expect((error as DataApiError<ErrorCode.CONFLICT>).code).toBe(ErrorCode.CONFLICT)

    // Other scopes are unaffected by a full scope.
    await expect(
      post({ body: { scopeKey: 'other', draft: draft('b'), payload: payload('b') } })
    ).resolves.toMatchObject({ scopeKey: 'other' })
  })

  it('reports missing deletes and reorder conflicts with production codes', async () => {
    const del = triggerFor('DELETE', '/followup-queues/:id')
    const missing = await del({ params: { id: 'nope' } }).catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(DataApiError)
    expect((missing as DataApiError<ErrorCode.NOT_FOUND>).code).toBe(ErrorCode.NOT_FOUND)

    const reorder = triggerFor('PATCH', '/followup-queues/order:batch')
    const reorderMissing = await reorder({ body: { moves: [{ id: 'nope', anchor: {} }] } }).catch((e: unknown) => e)
    expect((reorderMissing as DataApiError<ErrorCode.NOT_FOUND>).code).toBe(ErrorCode.NOT_FOUND)
  })
})
