import type { RootState } from '@renderer/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchMessages, mockGetSession, mockUpdateSession, mockGetSessionPaths, mockFetchSummary, mockMutate } =
  vi.hoisted(() => ({
    mockFetchMessages: vi.fn(),
    mockGetSession: vi.fn(),
    mockUpdateSession: vi.fn(),
    mockGetSessionPaths: vi.fn(() => ({ base: '/sessions', withId: (id: string) => `/sessions/${id}` })),
    mockFetchSummary: vi.fn(),
    mockMutate: vi.fn()
  }))

vi.mock('@renderer/services/db/DbService', () => ({
  DbService: { getInstance: () => ({ fetchMessages: mockFetchMessages }) }
}))

vi.mock('@renderer/api/agent', () => ({
  AgentApiClient: class {
    getSession = mockGetSession
    updateSession = mockUpdateSession
    getSessionPaths = mockGetSessionPaths
  }
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchMessagesSummary: mockFetchSummary,
  transformMessagesAndFetch: vi.fn()
}))

vi.mock('swr', () => ({ mutate: mockMutate }))

import { renameAgentSessionIfNeeded } from '../messageThunk'

const agentSession = { agentId: 'agent-1', sessionId: 'session-1' }

const getState = () =>
  ({
    settings: { apiServer: { apiKey: 'key', host: '127.0.0.1', port: 0 }, enableTopicNaming: true }
  }) as unknown as RootState

describe('renameAgentSessionIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchMessages.mockResolvedValue({ messages: [{ id: 'm1' }] })
    mockFetchSummary.mockResolvedValue({ text: 'Summarized title' })
    mockUpdateSession.mockResolvedValue({ id: 'session-1', name: 'Summarized title', name_manually_edited: false })
  })

  it('auto-names a session that has not been manually renamed', async () => {
    mockGetSession.mockResolvedValue({ id: 'session-1', name: 'Unnamed', name_manually_edited: false })

    await renameAgentSessionIfNeeded(agentSession, 'topic-1', getState)

    expect(mockUpdateSession).toHaveBeenCalledWith('agent-1', {
      id: 'session-1',
      name: 'Summarized title',
      name_manually_edited: false
    })
  })

  it('does not overwrite a name the user manually set', async () => {
    mockGetSession.mockResolvedValue({ id: 'session-1', name: 'My custom title', name_manually_edited: true })

    await renameAgentSessionIfNeeded(agentSession, 'topic-1', getState)

    expect(mockFetchSummary).not.toHaveBeenCalled()
    expect(mockUpdateSession).not.toHaveBeenCalled()
  })

  it('renames a manually-named session when force is set, clearing the manual flag', async () => {
    mockGetSession.mockResolvedValue({ id: 'session-1', name: 'My custom title', name_manually_edited: true })

    await renameAgentSessionIfNeeded(agentSession, 'topic-1', getState, { force: true })

    expect(mockUpdateSession).toHaveBeenCalledWith('agent-1', {
      id: 'session-1',
      name: 'Summarized title',
      name_manually_edited: false
    })
  })
})
