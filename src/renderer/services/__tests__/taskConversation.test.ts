import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@renderer/data/DataApiService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'

import { readTaskConversationPage, resolveTaskConversation } from '../taskConversation'

const task = { id: 'task', agentId: 'agent', reuseSession: false, reuseSessionId: null } as ScheduledTaskEntity
const session = { id: 'session', agentId: 'agent' }

describe('scheduled task conversation association', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('rejects a run belonging to another task before reading its conversation', async () => {
    const get = vi.spyOn(dataApiService, 'get').mockResolvedValue({ type: 'agent.task', scheduleId: 'other' } as never)
    await expect(resolveTaskConversation(task, 'run')).rejects.toThrow()
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/jobs/run'])
  })

  it('keeps an explicitly selected deleted conversation unavailable instead of choosing another run', async () => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/run')
        return { type: 'agent.task', scheduleId: 'task', metadata: { sessionId: 'deleted' } } as never
      throw DataApiErrorFactory.notFound('Session', 'deleted')
    })
    await expect(resolveTaskConversation(task, 'run')).rejects.toThrow()
  })

  it('prefers the valid bound conversation over the latest execution', async () => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/agent-sessions/bound') return { ...session, id: 'bound' } as never
      if (path === '/agent-sessions') return { items: [session] } as never
      return { items: [{ id: 'run', sessionId: 'session' }], total: 1 } as never
    })
    const result = await resolveTaskConversation({ ...task, reuseSession: true, reuseSessionId: 'bound' })
    expect(result.session?.id).toBe('bound')
  })

  it('finds the 51st execution without opening an unrelated latest Agent session', async () => {
    const get = vi.spyOn(dataApiService, 'get').mockImplementation(async (path, options) => {
      if (path === '/agent-sessions') return { items: [session] } as never
      const page = (options?.query as { page?: number })?.page
      return {
        items:
          page === 1
            ? Array.from({ length: 50 }, (_, i) => ({ id: `empty-${i}`, sessionId: null }))
            : [{ id: 'older', sessionId: 'session' }],
        total: 51
      } as never
    })
    const result = await resolveTaskConversation(task)
    expect(result.session?.id).toBe('session')
    expect(result.runId).toBe('older')
    expect(get.mock.calls.map(([path]) => path)).not.toContain('/agent-sessions/latest')
  })

  it('stops automatic lookup at 100 records and supports a deliberate third page', async () => {
    const get = vi.spyOn(dataApiService, 'get').mockImplementation(async (path, options) => {
      if (path === '/agent-sessions') return { items: [session] } as never
      const page = (options?.query as { page?: number })?.page ?? 1
      return {
        items:
          page < 3
            ? Array.from({ length: 50 }, (_, i) => ({ id: `${page}-${i}`, sessionId: null }))
            : [{ id: 'oldest', sessionId: 'session' }],
        total: 101
      } as never
    })
    const result = await resolveTaskConversation(task)
    expect(result).toMatchObject({ session: null, nextPage: 3, total: 101 })
    expect(get).toHaveBeenCalledTimes(2)
    expect((await readTaskConversationPage(task, result.nextPage)).session?.id).toBe('session')
  })

  it('does not continue an obsolete task lookup after its first response', async () => {
    const controller = new AbortController()
    const get = vi.spyOn(dataApiService, 'get').mockImplementation(async () => {
      controller.abort()
      return { items: [{ sessionId: 'session' }], total: 100 } as never
    })
    await expect(resolveTaskConversation(task, undefined, controller.signal)).rejects.toThrow()
    expect(get).toHaveBeenCalledTimes(1)
  })
})
