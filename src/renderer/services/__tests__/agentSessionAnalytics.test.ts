import { MockDataApiUtils, mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { trackAgentSessionCreated } from '../productAnalytics'

const tracked = () =>
  vi
    .mocked(window.api.ipcApi.request)
    .mock.calls.filter(([route]) => route === 'analytics.track')
    .map(([, event]) => event)

describe('trackAgentSessionCreated', () => {
  afterEach(() => {
    MockDataApiUtils.resetMocks()
    vi.mocked(window.api.ipcApi.request).mockClear()
  })

  it.each([
    ['builtin', { builtin_role: 'assistant' }],
    ['custom', {}]
  ])('reports a %s Agent by its role, never its id', async (agentKind, configuration) => {
    MockDataApiUtils.setCustomResponse('/agents/agent-1', 'GET', { id: 'agent-1', configuration })

    await trackAgentSessionCreated('agent-1')

    expect(tracked()).toEqual([{ event: 'agent_session_created', agentKind }])
  })

  it('reports nothing and never throws when the Agent cannot be read', async () => {
    vi.mocked(mockDataApiService.get).mockRejectedValueOnce(new Error('gone'))

    await expect(trackAgentSessionCreated('agent-1')).resolves.toBeUndefined()
    expect(tracked()).toEqual([])
  })
})
