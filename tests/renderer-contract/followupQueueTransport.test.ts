import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/hooks/useDataApi')
vi.unmock('@data/DataApiService')
vi.mock('@data/services/FollowupQueueService', () => ({ followupQueueService: service }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const { service } = vi.hoisted(() => ({
  service: {
    listByScope: vi.fn(),
    getState: vi.fn(),
    enqueue: vi.fn(),
    remove: vi.fn(),
    claim: vi.fn(),
    reorderBatch: vi.fn(),
    markFailed: vi.fn(),
    heartbeat: vi.fn()
  }
}))

import { followupQueueHandlers } from '../../src/main/data/api/handlers/followupQueues'
import { useFollowupQueue } from '../../src/renderer/components/composer/useFollowupQueue'
import { createSWRTestWrapper } from '../../src/renderer/data/hooks/__tests__/testUtils'

const ids = [
  '11111111-1111-7111-8111-111111111111',
  '22222222-2222-7222-8222-222222222222',
  '33333333-3333-7333-8333-333333333333'
]
const scope = 'topic:assistant'
const originalApi = window.api
afterEach(() => {
  Object.defineProperty(window, 'api', { configurable: true, value: originalApi })
  vi.clearAllMocks()
})

// Keep the renderer caller, fetcher and client real. Only bridge dispatch and
// persistence are faked; handler validation below is the production boundary.

describe('production edit-transfer transport contract', () => {
  it('carries the actual hook DELETE body through mutation, IPC and validated handler before release', async () => {
    let rows = ids.map((id, index) => ({
      id,
      scopeKey: scope,
      draft: { text: String(index), tokens: [] },
      payload: { text: String(index), userMessageParts: [] },
      status: 'pending',
      orderKey: String(index),
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      sentAt: null
    }))
    const transferred: string[] = []
    service.listByScope.mockImplementation(() => [...rows])
    service.getState.mockImplementation(() => ({ scopeKey: scope, paused: false }))
    service.claim.mockReturnValue({ claimed: true, alreadySent: false })
    service.enqueue.mockImplementation((body) => {
      const existing = rows.find((row) => row.id === body.id)
      if (!existing) rows = [{ ...rows[0], ...body, orderKey: '0' }, ...rows]
      return existing ?? rows[0]
    })
    service.remove.mockImplementation((id, transferHeldId) => {
      if (transferHeldId) transferred.push(transferHeldId)
      rows = rows.filter((row) => row.id !== id)
    })
    const seen: Array<{ method: string; path: string; body?: unknown }> = []
    const request = vi.fn(async (req) => {
      seen.push(req)
      const match = req.path.match(/^\/followup-queues\/([^/]+)(?:\/(claim|heartbeat))?$/)
      let data: unknown
      if (req.path === '/followup-queues') {
        data =
          req.method === 'GET'
            ? await followupQueueHandlers['/followup-queues'].GET({ query: req.params })
            : await followupQueueHandlers['/followup-queues'].POST({ body: req.body })
      } else if (req.path === '/followup-queue-states') {
        data = await followupQueueHandlers['/followup-queue-states'].GET({ query: req.params })
      } else if (match?.[2] === 'claim') {
        data = await followupQueueHandlers['/followup-queues/:id/claim'].POST({
          params: { id: match[1] },
          body: req.body
        })
      } else if (match && req.method === 'DELETE') {
        data = await followupQueueHandlers['/followup-queues/:id'].DELETE({ params: { id: match[1] }, body: req.body })
      } else if (req.path === '/followup-queues/order:batch') data = undefined
      else throw new Error(`Unexpected request ${req.method} ${req.path}`)
      return { id: req.id, status: 200, data }
    })
    Object.defineProperty(window, 'api', { configurable: true, value: { ...window.api, dataApi: { request } } })
    const { Wrapper } = createSWRTestWrapper()
    const { result, unmount } = renderHook(
      () =>
        useFollowupQueue({ scopeKey: scope, status: 'streaming', lastCompletedAt: null, onDrain: async () => true }),
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    await act(async () => {
      await result.current.takeForEdit(ids[0], () => null)
    })
    await act(async () => {
      await result.current.takeForEdit(ids[1], () => ({
        draft: { text: 'edited', tokens: [] },
        payload: { text: 'edited', userMessageParts: [] }
      }))
    })
    expect(transferred).toHaveLength(1)
    expect(seen).toContainEqual(
      expect.objectContaining({
        method: 'DELETE',
        path: `/followup-queues/${ids[1]}`,
        body: { transferHeldId: transferred[0] }
      })
    )
    expect(service.remove).toHaveBeenCalledWith(ids[1], transferred[0])
    const transferDelete = seen.findIndex((req) => req.method === 'DELETE' && req.path === `/followup-queues/${ids[1]}`)
    const release = seen.findIndex(
      (req, index) => index > transferDelete && req.method === 'POST' && req.path === '/followup-queues'
    )
    expect(release).toBeGreaterThan(transferDelete)
    unmount()
  })
})
