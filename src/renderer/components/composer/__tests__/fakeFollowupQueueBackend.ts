import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { vi } from 'vitest'

import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import {
  FOLLOWUP_QUEUE_LIMIT,
  STALE_SENDING_CLAIM_MS,
  type FollowupQueueItem as FollowupQueueRow
} from '@shared/data/types/followupQueue'

/**
 * In-test fake for the follow-up queue DataApi endpoints.
 *
 * Holds queue rows + paused state in memory and serves `GET
 * /followup-queues`, the item mutations, and `PUT /followup-queue-states`
 * through the `useDataApi` mocks, so composer suites can drive the real
 * `useFollowupQueue` drain/enqueue flows without IPC. Unknown paths and
 * mutations delegate to the previous mock implementations.
 *
 * Claim and reorder semantics mirror production: `claim:head` arbitrates on
 * the oldest row only (a live `sending` head parks the round instead of
 * handing out the next row), stale `sending` rows are reclaimable, reorders
 * are refused while a live send holds a claim, and reorders rewrite `orderKey`
 * so `claim:head` keeps selecting the display head.
 *
 * Install in `beforeEach` — state is fresh per test.
 */
export function installFakeFollowupQueueBackend() {
  const state: { rows: FollowupQueueRow[]; pausedByScope: Map<string, boolean> } = {
    rows: [],
    pausedByScope: new Map()
  }
  let counter = 0

  // Production treats a `sending` row as live (owned) until the reclaim
  // lease expires; only stale ones are claimable or reorderable-around.
  const isLiveSending = (row: FollowupQueueRow): boolean =>
    row.status === 'sending' && Date.parse(row.updatedAt) >= Date.now() - STALE_SENDING_CLAIM_MS
  const isClaimable = (row: FollowupQueueRow): boolean =>
    row.status === 'pending' || row.status === 'failed' || (row.status === 'sending' && !isLiveSending(row))
  const scopedByOrder = (scopeKey: string): FollowupQueueRow[] =>
    state.rows.filter((candidate) => candidate.scopeKey === scopeKey).sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))

  const defaultQueryImpl = mockUseQuery.getMockImplementation()
  mockUseQuery.mockImplementation(((path: string, options?: unknown) => {
    if (path === '/followup-queues') {
      return {
        data: [...state.rows],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    }
    if (path === '/followup-queue-states') {
      // Echo the requested scope like the real read model, which always
      // resolves state for the queried scope (defaulting to unpaused).
      const scopeKey = (options as { query?: { scopeKey?: string } } | undefined)?.query?.scopeKey ?? ''
      return {
        data: { scopeKey, paused: state.pausedByScope.get(scopeKey) ?? false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    }
    return (defaultQueryImpl as (...args: unknown[]) => unknown)?.(path, options)
  }) as never)

  const defaultMutationImpl = mockUseMutation.getMockImplementation()
  mockUseMutation.mockImplementation(((method: string, path: string, options?: unknown) => {
    const shell = { isLoading: false, error: undefined }
    if (method === 'POST' && path === '/followup-queues') {
      return {
        ...shell,
        trigger: vi.fn(
          async ({
            body
          }: {
            body: {
              id?: string
              scopeKey: string
              draft: FollowupQueueRow['draft']
              payload: FollowupQueueRow['payload']
            }
          }) => {
            // Mirror production idempotency: a retried POST carries the same
            // client-generated id and returns the existing row.
            if (body.id) {
              const duplicate = state.rows.find((row) => row.id === body.id)
              if (duplicate) return duplicate
            }
            // Mirror production: the write path rejects past the per-scope limit.
            const scopedCount = state.rows.filter((row) => row.scopeKey === body.scopeKey).length
            if (scopedCount >= FOLLOWUP_QUEUE_LIMIT) {
              throw new DataApiError(ErrorCode.CONFLICT, `fake queue: scope ${body.scopeKey} is full`, 409)
            }
            counter += 1
            const row: FollowupQueueRow = {
              id: body.id ?? crypto.randomUUID(),
              scopeKey: body.scopeKey,
              draft: body.draft,
              payload: body.payload,
              status: 'pending',
              sentAt: null,
              orderKey: `a${counter}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
            state.rows.push(row)
            return row
          }
        )
      }
    }
    if (method === 'DELETE' && path === '/followup-queues/:id') {
      return {
        ...shell,
        trigger: vi.fn(async ({ params }: { params: { id: string } }) => {
          const index = state.rows.findIndex((row) => row.id === params.id)
          if (index === -1) throw new DataApiError(ErrorCode.NOT_FOUND, `fake queue: missing id ${params.id}`, 404)
          state.rows.splice(index, 1)
          return undefined
        })
      }
    }
    if (method === 'PATCH' && path === '/followup-queues/order:batch') {
      return {
        ...shell,
        trigger: vi.fn(
          async ({
            body
          }: {
            body: { moves: Array<{ id: string; anchor: { before?: string; after?: string; position?: string } }> }
          }) => {
            const first = state.rows.find((row) => row.id === body.moves[0]?.id)
            if (!first) throw new DataApiError(ErrorCode.NOT_FOUND, `fake queue: missing id ${body.moves[0]?.id}`, 404)
            if (state.rows.some((row) => row.scopeKey === first.scopeKey && isLiveSending(row))) {
              throw new DataApiError(ErrorCode.CONFLICT, 'fake queue: reorder conflicts with an in-flight send', 409)
            }
            for (const move of body.moves) {
              const index = state.rows.findIndex((row) => row.id === move.id)
              if (index === -1) throw new DataApiError(ErrorCode.NOT_FOUND, `fake queue: missing id ${move.id}`, 404)
              const [moved] = state.rows.splice(index, 1)
              if (move.anchor.position === 'first') state.rows.unshift(moved)
              else if (move.anchor.position === 'last') state.rows.push(moved)
              else {
                const targetId = move.anchor.before ?? move.anchor.after ?? ''
                const targetIndex = state.rows.findIndex((row) => row.id === targetId)
                if (targetIndex === -1)
                  throw new DataApiError(ErrorCode.NOT_FOUND, `fake queue: missing anchor ${targetId}`, 404)
                state.rows.splice(move.anchor.before ? targetIndex : targetIndex + 1, 0, moved)
              }
            }
            // Mirror production: reorder rewrites orderKey, so claim:head
            // (which sorts by orderKey) keeps selecting the display head.
            const scoped = state.rows.filter((row) => row.scopeKey === first.scopeKey)
            for (const [index, row] of scoped.entries()) {
              row.orderKey = `a${String(index).padStart(6, '0')}`
            }
            return undefined
          }
        )
      }
    }
    if (method === 'POST' && path === '/followup-queues/:id/claim') {
      return {
        ...shell,
        trigger: vi.fn(async ({ params }: { params: { id: string } }) => {
          const row = state.rows.find((candidate) => candidate.id === params.id)
          if (row && isClaimable(row)) {
            row.status = 'sending'
            row.updatedAt = new Date().toISOString()
            return { claimed: true, alreadySent: row.sentAt != null }
          }
          return { claimed: false, alreadySent: false }
        })
      }
    }
    if (method === 'POST' && path === '/followup-queues/claim:head') {
      return {
        ...shell,
        trigger: vi.fn(async ({ body }: { body: { scopeKey: string } }) => {
          // Oldest row only, like production: a live head parks the round
          // instead of handing out the next row.
          const [head] = scopedByOrder(body.scopeKey)
          if (!head || !isClaimable(head)) return { claimed: false }
          head.status = 'sending'
          head.updatedAt = new Date().toISOString()
          return { claimed: true, id: head.id, alreadySent: head.sentAt != null }
        })
      }
    }
    if (method === 'POST' && path === '/followup-queues/:id/fail') {
      return {
        ...shell,
        trigger: vi.fn(async ({ params }: { params: { id: string } }) => {
          const row = state.rows.find((candidate) => candidate.id === params.id)
          if (row && row.status === 'sending') {
            row.status = 'failed'
            row.updatedAt = new Date().toISOString()
          }
          return undefined
        })
      }
    }
    if (method === 'POST' && path === '/followup-queues/:id/sent') {
      return {
        ...shell,
        trigger: vi.fn(async ({ params }: { params: { id: string } }) => {
          const row = state.rows.find((candidate) => candidate.id === params.id)
          if (row && row.status === 'sending') {
            const now = new Date().toISOString()
            row.sentAt = now
            row.updatedAt = now
          }
          return undefined
        })
      }
    }
    if (method === 'POST' && path === '/followup-queues/:id/heartbeat') {
      return {
        ...shell,
        trigger: vi.fn(async ({ params }: { params: { id: string } }) => {
          const row = state.rows.find((candidate) => candidate.id === params.id)
          if (row && row.status === 'sending' && isLiveSending(row)) {
            row.updatedAt = new Date().toISOString()
            return { live: true }
          }
          return { live: false }
        })
      }
    }
    if (method === 'PUT' && path === '/followup-queue-states') {
      return {
        ...shell,
        trigger: vi.fn(async ({ body }: { body: { scopeKey: string; paused: boolean } }) => {
          state.pausedByScope.set(body.scopeKey, body.paused)
          return { scopeKey: body.scopeKey, paused: body.paused, createdAt: '', updatedAt: '' }
        })
      }
    }
    return (defaultMutationImpl as (...args: unknown[]) => unknown)?.(method, path, options)
  }) as never)

  return state
}
