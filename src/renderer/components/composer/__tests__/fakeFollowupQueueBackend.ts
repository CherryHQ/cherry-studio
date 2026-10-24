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
 * so `claim:head` keeps selecting the display head. Editor-owned recovery
 * copies enqueued with `held: true` stay ineligible for delivery (skipped by
 * `claim:head`, refused by `:id/claim`) until they age out, mirroring the
 * production `held:edit-restore` claim sentinel.
 *
 * Install in `beforeEach` — state is fresh per test.
 */
export function installFakeFollowupQueueBackend() {
  const state: { rows: FollowupQueueRow[]; pausedByScope: Map<string, boolean> } = {
    rows: [],
    pausedByScope: new Map()
  }
  let counter = 0
  // Server-side claim tokens (not part of the entity); mirrors production's retry-stable claims.
  const claimTokens = new Map<string, string | undefined>()
  // Mirrors production's `held:edit-restore` claim sentinel: editor-owned
  // recovery copies ineligible for delivery while their session is fresh.
  const HELD_TOKEN = 'held:edit-restore'
  const heldRows = new Set<string>()
  // Mirrors production's completion-scoped claim:head arbitration: a bounded
  // set of reservations tagged with the granting claim's token.
  const consumedCompletions = new Map<string, Array<{ completionAt: number; claimToken?: string }>>()
  const hasConsumed = (scopeKey: string, completionAt: number) =>
    consumedCompletions.get(scopeKey)?.some((entry) => entry.completionAt === completionAt) ?? false
  const recordConsumed = (scopeKey: string, completionAt: number, claimToken?: string) => {
    const entries = consumedCompletions.get(scopeKey) ?? []
    if (!entries.some((entry) => entry.completionAt === completionAt && entry.claimToken === claimToken)) {
      entries.push({ completionAt, claimToken })
      consumedCompletions.set(scopeKey, entries)
    }
  }
  const releaseConsumed = (scopeKey: string, claimToken?: string) => {
    const entries = consumedCompletions.get(scopeKey)
    if (!entries) return
    const kept = entries.filter((entry) => entry.claimToken !== claimToken)
    if (kept.length === 0) consumedCompletions.delete(scopeKey)
    else consumedCompletions.set(scopeKey, kept)
  }

  // Production treats a `sending` row as live (owned) until the reclaim
  // lease expires; only stale ones are claimable or reorderable-around.
  const isLiveSending = (row: FollowupQueueRow): boolean =>
    row.status === 'sending' && Date.parse(row.updatedAt) >= Date.now() - STALE_SENDING_CLAIM_MS
  const isClaimable = (row: FollowupQueueRow): boolean =>
    row.status === 'pending' || row.status === 'failed' || (row.status === 'sending' && !isLiveSending(row))
  // A held copy is live while its stamp is fresh; an aged-out orphan rejoins
  // delivery, mirroring the SQL `updatedAt < cutoff` escape hatch.
  const isLiveHeld = (row: FollowupQueueRow): boolean =>
    heldRows.has(row.id) && Date.parse(row.updatedAt) >= Date.now() - STALE_SENDING_CLAIM_MS
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
              held?: boolean
            }
          }) => {
            // Mirror production idempotency: a retried POST carries the same
            // client-generated id and returns the existing row. A held retry
            // re-stamps its landed copy AND refreshes an already-held copy's
            // liveness stamp (so a live edit session outlives the stale
            // window), unless a delivery claim is already in flight for it.
            if (body.id) {
              const duplicate = state.rows.find((row) => row.id === body.id)
              if (duplicate) {
                if (body.held) {
                  const token = claimTokens.get(duplicate.id)
                  const liveDeliveryClaim =
                    duplicate.status === 'sending' && isLiveSending(duplicate) && token != null && token !== HELD_TOKEN
                  if (!liveDeliveryClaim) {
                    heldRows.add(duplicate.id)
                    claimTokens.set(duplicate.id, HELD_TOKEN)
                    duplicate.updatedAt = new Date().toISOString()
                  }
                } else if (!body.held && duplicate.status === 'pending' && heldRows.has(duplicate.id)) {
                  // Mirror production: a non-held retry after editor ownership
                  // transferred releases the recovery hold.
                  heldRows.delete(duplicate.id)
                  claimTokens.set(duplicate.id, undefined)
                  duplicate.updatedAt = new Date().toISOString()
                }
                return duplicate
              }
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
              orderKey: `a${String(counter).padStart(6, '0')}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
            state.rows.push(row)
            if (body.held) {
              heldRows.add(row.id)
              claimTokens.set(row.id, HELD_TOKEN)
            }
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
          heldRows.delete(params.id)
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
        trigger: vi.fn(
          async ({
            params,
            body
          }: {
            params: { id: string }
            body?: { claimToken?: string; completionAt?: number }
          }) => {
            const row = state.rows.find((candidate) => candidate.id === params.id)
            const ownRetry =
              !!body?.claimToken && row?.status === 'sending' && claimTokens.get(row.id) === body.claimToken
            // Mirror production: live held recovery copies refuse even manual steers.
            if (row && !isLiveHeld(row) && (ownRetry || isClaimable(row))) {
              row.status = 'sending'
              heldRows.delete(row.id)
              claimTokens.set(row.id, body?.claimToken)
              row.updatedAt = new Date().toISOString()
              // Mirror production: manual delivery joins the completion accounting.
              if (body?.completionAt != null) recordConsumed(row.scopeKey, body.completionAt, body.claimToken)
              return { claimed: true, alreadySent: row.sentAt != null }
            }
            return { claimed: false, alreadySent: false }
          }
        )
      }
    }
    if (method === 'POST' && path === '/followup-queues/claim:head') {
      return {
        ...shell,
        trigger: vi.fn(async ({ body }: { body: { scopeKey: string; claimToken?: string; completionAt?: number } }) => {
          // Oldest row only, like production: a live head parks the round
          // instead of handing out the next row. Live held recovery copies
          // are skipped (not parked behind), mirroring the SQL-level filter.
          const [head] = scopedByOrder(body.scopeKey).filter((row) => !isLiveHeld(row))
          const ownRetry =
            !!body.claimToken && head?.status === 'sending' && claimTokens.get(head.id) === body.claimToken
          // Mirror production: one delivery per completion; the winner's own
          // retry re-acquires, other claims for a consumed completion are obsolete.
          if (!ownRetry && body.completionAt != null && hasConsumed(body.scopeKey, body.completionAt))
            return { claimed: false }
          if (!head || !(ownRetry || isClaimable(head))) return { claimed: false }
          head.status = 'sending'
          heldRows.delete(head.id)
          claimTokens.set(head.id, body.claimToken)
          head.updatedAt = new Date().toISOString()
          if (body.completionAt != null) recordConsumed(body.scopeKey, body.completionAt, body.claimToken)
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
            // Mirror production: a claim released without dispatch drops its
            // completion reservation.
            releaseConsumed(row.scopeKey, claimTokens.get(row.id))
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
