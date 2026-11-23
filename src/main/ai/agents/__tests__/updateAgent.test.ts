import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAgentMock, updateAgentMock, trackProductEvent } = vi.hoisted(() => ({
  getAgentMock: vi.fn(),
  updateAgentMock: vi.fn(),
  trackProductEvent: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AnalyticsService: { trackProductEvent } })
})
vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: getAgentMock, updateAgent: updateAgentMock }
}))

const { updateAgent } = await import('../updateAgent')

const agent = { id: 'agent-1', name: 'Reviewer', instructions: 'Keep it short', configuration: {} }

describe('updateAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports only the settings that changed, with values for enums and booleans only', () => {
    getAgentMock.mockReturnValueOnce({
      ...agent,
      configuration: { permission_mode: 'default', heartbeat_enabled: false, env_vars: { A: '1' } }
    })
    const updates = {
      name: 'Renamed secret project',
      instructions: 'Keep it short',
      configuration: { permission_mode: 'plan', heartbeat_enabled: true, env_vars: { TOKEN: 'secret' } },
      skillUpdates: [{ skillId: 'skill-1', isEnabled: false }]
    }
    updateAgentMock.mockReturnValueOnce({ ...agent, ...updates })

    expect(updateAgent('agent-1', updates as never)).toMatchObject({ name: 'Renamed secret project' })

    const events = trackProductEvent.mock.calls.map(([event]) => event)
    expect(events).toHaveLength(5)
    expect(events).toEqual(
      expect.arrayContaining([
        { event: 'agent_setting_changed', key: 'name' },
        { event: 'agent_setting_changed', key: 'configuration.permission_mode', value: 'plan' },
        { event: 'agent_setting_changed', key: 'configuration.heartbeat_enabled', value: true },
        { event: 'agent_setting_changed', key: 'configuration.env_vars' },
        { event: 'feature_used', feature: 'skills', action: 'skill_disabled', origin: 'ui' }
      ])
    )
    expect(JSON.stringify(events)).not.toMatch(/secret|Keep it short/)
  })

  it('keeps the saved edit when analytics fails', () => {
    getAgentMock.mockReturnValueOnce(agent)
    updateAgentMock.mockReturnValueOnce({ ...agent, name: 'Renamed' })
    trackProductEvent.mockImplementation(() => {
      throw new Error('analytics down')
    })

    expect(updateAgent('agent-1', { name: 'Renamed' })).toMatchObject({ name: 'Renamed' })
  })

  it('throws and reports nothing when the Agent does not exist', () => {
    getAgentMock.mockReturnValueOnce(null)
    updateAgentMock.mockReturnValueOnce(null)

    expect(() => updateAgent('missing', { name: 'Renamed' })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(trackProductEvent).not.toHaveBeenCalled()
  })
})
