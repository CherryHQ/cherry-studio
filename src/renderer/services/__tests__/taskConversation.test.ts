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
    const get = vi.spyOn(dataApiService, 'get').mockResolvedValue({ type: 'agent.task', scheduleId: 'other' })
    await expect(resolveTaskConversation(task, 'run')).rejects.toThrow()
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/jobs/run'])
  })

  it.each([null, 'deleted'])('retains stored facts without substituting a conversation: %s', async (sessionId) => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/run')
        return {
          id: 'run',
          type: 'agent.task',
          scheduleId: 'task',
          status: 'failed',
          metadata: { sessionId },
          output: { result: 'old sentinel\n<script>plain</script>' },
          error: { message: 'failure sentinel' },
          startedAt: null,
          scheduledAt: '2026-01-01T00:00:00Z'
        } as never
      if (path === '/agent-sessions/deleted') throw DataApiErrorFactory.notFound('Session', 'deleted')
      if (path === '/agent-sessions') return { items: [session] } as never
      return { items: [{ id: 'other', sessionId: 'session' }], total: 1 } as never
    })
    expect(await resolveTaskConversation(task, 'run')).toMatchObject({
      session: null,
      runId: 'run',
      selectedRun: {
        id: 'run',
        status: 'failed',
        startedAt: '2026-01-01T00:00:00Z',
        result: 'old sentinel\n<script>plain</script>',
        error: 'failure sentinel'
      },
      logs: [{ id: 'other' }]
    })
  })

  it.each([
    [{ kind: 'executed' }, '{"kind":"executed"}'],
    [{}, '{}'],
    [null, null],
    [{ result: 42 }, '{"result":42}']
  ])('retains run facts using the history stored-result projection: %j', async (output, expectedResult) => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/run')
        return {
          id: 'run',
          type: 'agent.task',
          scheduleId: 'task',
          metadata: {},
          output,
          status: 'failed',
          startedAt: '2026-01-01T00:00:00Z',
          error: { message: 'failure sentinel' }
        } as never
      return { items: [], total: 0 } as never
    })
    const resolved = await resolveTaskConversation(task, 'run')
    expect(resolved.selectedRun).toEqual({
      id: 'run',
      status: 'failed',
      startedAt: '2026-01-01T00:00:00Z',
      result: expectedResult,
      error: 'failure sentinel'
    })
  })

  it.each([
    ['untyped 404', { status: 404 }],
    ['wrong resource', DataApiErrorFactory.notFound('Task', 'deleted')],
    ['wrong id', DataApiErrorFactory.notFound('Session', 'other')],
    ['handler', DataApiErrorFactory.notFound('Handler', 'deleted')],
    ['500', Object.assign(DataApiErrorFactory.notFound('Session', 'deleted'), { status: 500 })],
    ['timeout', new Error('timeout')],
    ['permission', new Error('permission denied')],
    ['database', new Error('database unavailable')]
  ])('rejects unexpected session failures: %s', async (_name, error) => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/run')
        return { id: 'run', type: 'agent.task', scheduleId: 'task', metadata: { sessionId: 'deleted' } } as never
      throw error
    })
    await expect(resolveTaskConversation(task, 'run')).rejects.toBe(error)
  })

  it.each([
    ['foreign task', { type: 'agent.task', scheduleId: 'other' }],
    ['wrong type', { type: 'other', scheduleId: 'task' }],
    ['missing job', null]
  ])('rejects invalid selected jobs: %s', async (_name, job) => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async () => {
      if (!job) throw DataApiErrorFactory.notFound('Job', 'run')
      return job as never
    })
    await expect(resolveTaskConversation(task, 'run')).rejects.toThrow()
  })

  it('does not swallow a foreign-task log 404', async () => {
    const error = DataApiErrorFactory.notFound('Task', 'task')
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/run') return { id: 'run', type: 'agent.task', scheduleId: 'task', metadata: {} } as never
      throw error
    })
    await expect(resolveTaskConversation(task, 'run')).rejects.toBe(error)
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

  it('skips an unavailable bound session and background/deleted candidates through normal conversation reads', async () => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/agent-sessions/bound') throw DataApiErrorFactory.notFound('Session', 'bound')
      if (path === '/agent-sessions') return { items: [session] } as never
      return {
        items: [
          { id: 'background-run', sessionId: 'background' },
          { id: 'valid-run', sessionId: 'session' }
        ],
        total: 2
      } as never
    })
    const found = await resolveTaskConversation({ ...task, reuseSession: true, reuseSessionId: 'bound' })
    expect(found.session?.id).toBe('session')
    expect(found.runId).toBe('valid-run')
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
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path, options) => {
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
    expect((await readTaskConversationPage(task, result.nextPage)).session?.id).toBe('session')
  })

  it('does not continue an obsolete task lookup after its first response', async () => {
    const controller = new AbortController()
    vi.spyOn(dataApiService, 'get').mockImplementation(async () => {
      controller.abort()
      return { items: [{ sessionId: 'session' }], total: 100 } as never
    })
    await expect(resolveTaskConversation(task, undefined, controller.signal)).rejects.toThrow()
  })
})

it.each([{ result: 'old sentinel' }, { kind: 'executed', result: 'new sentinel' }])(
  'reads explicit facts outside the first history page: %j',
  async (output) => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/outside')
        return {
          id: 'outside',
          type: 'agent.task',
          scheduleId: 'task',
          metadata: {},
          output,
          startedAt: '2026-01-01T00:00:00Z',
          status: 'pending',
          error: null
        } as never
      return { items: [], total: 51 } as never
    })
    const resolved = await resolveTaskConversation(task, 'outside')
    expect(resolved.selectedRun).toMatchObject({ id: 'outside', status: 'pending', result: output.result })
    expect(resolved.logs).toEqual([])
    expect(resolved.session).toBeNull()
  }
)

it.each([{ result: 'old sentinel' }, { kind: 'executed', result: 'new sentinel' }])(
  'keeps readable conversations preferred for either output shape: %j',
  async (output) => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/run')
        return {
          id: 'run',
          type: 'agent.task',
          scheduleId: 'task',
          metadata: { sessionId: 'session' },
          output,
          startedAt: '2026-01-01T00:00:00Z',
          status: 'completed',
          error: null
        } as never
      if (path === '/agent-sessions/session') return session as never
      return { items: [], total: 0 } as never
    })
    const resolved = await resolveTaskConversation(task, 'run')
    expect(resolved.session?.id).toBe('session')
    expect(resolved.selectedRun?.result).toBe(output.result)
  }
)

it('keeps abort a cancellation even when the recorded session is missing', async () => {
  const controller = new AbortController()
  vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
    if (path === '/jobs/run')
      return { id: 'run', type: 'agent.task', scheduleId: 'task', metadata: { sessionId: 'session' } } as never
    controller.abort()
    throw DataApiErrorFactory.notFound('Session', 'session')
  })
  await expect(resolveTaskConversation(task, 'run', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('retains the automatically chosen run facts alongside its readable conversation', async () => {
  vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
    if (path === '/agent-sessions') return { items: [session] } as never
    return {
      items: [
        { id: 'unreadable', sessionId: 'deleted', result: 'other text' },
        {
          id: 'chosen',
          sessionId: 'session',
          startedAt: '2026-01-01T00:00:00Z',
          status: 'completed',
          result: 'chosen text',
          error: null
        }
      ],
      total: 2
    } as never
  })
  const resolved = await resolveTaskConversation(task)
  expect(resolved.session?.id).toBe('session')
  expect(resolved.selectedRun).toEqual({
    id: 'chosen',
    startedAt: '2026-01-01T00:00:00Z',
    status: 'completed',
    result: 'chosen text',
    error: null
  })
})

it.each([true, false])('retains bound-session facts only for a matching history session: %s', async (matching) => {
  const bound = { ...session, id: 'bound' }
  vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
    if (path === '/agent-sessions/bound') return bound as never
    if (path === '/agent-sessions') return { items: [matching ? bound : session] } as never
    return {
      items: [{ id: 'run', sessionId: matching ? 'bound' : 'session', status: 'completed', result: 'stored text' }],
      total: 1
    } as never
  })
  const resolved = await resolveTaskConversation({ ...task, reuseSession: true, reuseSessionId: 'bound' })
  expect(resolved.session?.id).toBe('bound')
  expect(resolved.selectedRun).toEqual(
    matching
      ? {
          id: 'run',
          startedAt: undefined,
          status: 'completed',
          result: 'stored text',
          error: null
        }
      : null
  )
})

it.each(['explicit', 'automatic'])(
  'preserves non-string result output as stored JSON on the %s path',
  async (pathKind) => {
    vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
      if (path === '/jobs/run')
        return {
          id: 'run',
          type: 'agent.task',
          scheduleId: 'task',
          metadata: { sessionId: 'session' },
          status: 'completed',
          output: { result: 42 }
        } as never
      if (path === '/agent-sessions/session') return session as never
      if (path === '/agent-sessions') return { items: [session] } as never
      return {
        items: [{ id: 'run', sessionId: 'session', status: 'completed', result: '{"result":42}' }],
        total: 1
      } as never
    })
    const resolved = await resolveTaskConversation(task, pathKind === 'explicit' ? 'run' : undefined)
    expect(resolved.selectedRun?.id).toBe('run')
    expect(resolved.selectedRun?.result).toBe('{"result":42}')
  }
)
