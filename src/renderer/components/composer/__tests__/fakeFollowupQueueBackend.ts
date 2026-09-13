import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { vi } from 'vitest'

import type { FollowupQueueItem as FollowupQueueRow } from '@shared/data/types/followupQueue'

/**
 * In-test fake for the follow-up queue DataApi endpoints.
 *
 * Holds queue rows + paused state in memory and serves `GET
 * /followup-queues`, the item mutations, and `PUT /followup-queue-states`
 * through the `useDataApi` mocks, so composer suites can drive the real
 * `useFollowupQueue` drain/enqueue flows without IPC. Unknown paths and
 * mutations delegate to the previous mock implementations.
 *
 * Install in `beforeEach` — state is fresh per test.
 */
export function installFakeFollowupQueueBackend() {
  const state: { rows: FollowupQueueRow[]; paused: boolean } = { rows: [], paused: false }
  let counter = 0

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
        data: { scopeKey, paused: state.paused, createdAt: '', updatedAt: '' },
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
            body: { scopeKey: string; draft: FollowupQueueRow['draft']; payload: FollowupQueueRow['payload'] }
          }) => {
            counter += 1
            const row: FollowupQueueRow = {
              id: `fake-queue-${counter}`,
              scopeKey: body.scopeKey,
              draft: body.draft,
              payload: body.payload,
              status: 'pending',
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
          if (index === -1) throw new Error(`fake queue: missing id ${params.id}`)
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
            for (const move of body.moves) {
              const index = state.rows.findIndex((row) => row.id === move.id)
              if (index === -1) throw new Error(`fake queue: missing id ${move.id}`)
              const [moved] = state.rows.splice(index, 1)
              if (move.anchor.position === 'first') state.rows.unshift(moved)
              else if (move.anchor.position === 'last') state.rows.push(moved)
              else {
                const targetId = move.anchor.before ?? move.anchor.after ?? ''
                const targetIndex = state.rows.findIndex((row) => row.id === targetId)
                if (targetIndex === -1) throw new Error(`fake queue: missing anchor ${targetId}`)
                state.rows.splice(move.anchor.before ? targetIndex : targetIndex + 1, 0, moved)
              }
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
          if (row && (row.status === 'pending' || row.status === 'failed')) {
            row.status = 'sending'
            return { claimed: true }
          }
          return { claimed: false }
        })
      }
    }
    if (method === 'POST' && path === '/followup-queues/claim:head') {
      return {
        ...shell,
        trigger: vi.fn(async ({ body }: { body: { scopeKey: string } }) => {
          const head = state.rows
            .filter((candidate) => candidate.scopeKey === body.scopeKey)
            .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
            .find((candidate) => candidate.status === 'pending' || candidate.status === 'failed')
          if (!head) return { claimed: false }
          head.status = 'sending'
          return { claimed: true, id: head.id }
        })
      }
    }
    if (method === 'POST' && path === '/followup-queues/:id/fail') {
      return {
        ...shell,
        trigger: vi.fn(async ({ params }: { params: { id: string } }) => {
          const row = state.rows.find((candidate) => candidate.id === params.id)
          if (row && row.status === 'sending') row.status = 'failed'
          return undefined
        })
      }
    }
    if (method === 'PUT' && path === '/followup-queue-states') {
      return {
        ...shell,
        trigger: vi.fn(async ({ body }: { body: { scopeKey: string; paused: boolean } }) => {
          state.paused = body.paused
          return { scopeKey: body.scopeKey, paused: state.paused, createdAt: '', updatedAt: '' }
        })
      }
    }
    return (defaultMutationImpl as (...args: unknown[]) => unknown)?.(method, path, options)
  }) as never)

  return state
}
