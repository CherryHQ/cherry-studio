import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  return {
    ...mock,
    application: {
      ...mock.application,
      get: (name: string) => (name === 'TraceStorageService' ? { getTaskTiming: query } : mock.application.get(name))
    }
  }
})

import { CherryTimingTools } from '../cherryTimingTools'

beforeEach(() => {
  query.mockReset()
})

describe('task_timing scope', () => {
  it('binds reads to the calling session even if model arguments name another session', async () => {
    query.mockImplementation(async (sessionId) => ({
      tasks: [],
      nodes: [],
      nextOffset: null,
      availability: sessionId === 'own' ? 'unavailable' : 'secret'
    }))
    const tool = new CherryTimingTools('own')
    const result = await tool.call({ sessionId: 'other', taskId: 'other-task' })
    expect(query).toHaveBeenCalledWith('own', { taskId: 'other-task', offset: 0, limit: 100 })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ tasks: [], nodes: [], nextOffset: null, availability: 'unavailable' }) }
    ])
  })

  it('rejects unbounded node requests before reaching storage', async () => {
    await expect(new CherryTimingTools('own').call({ limit: 201 })).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
})
