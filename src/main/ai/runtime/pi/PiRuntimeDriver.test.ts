import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  prepareWorkspace: vi.fn(),
  ensureRetiredHistory: vi.fn()
}))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('@main/ai/runtime/agentSessionWorkspace', () => ({
  prepareAgentSessionWorkspaceDirectory: mocks.prepareWorkspace
}))
vi.mock('./retiredSessionHistory', () => ({
  ensureRetiredSessionHistory: mocks.ensureRetiredHistory,
  migrateRetiredSessionHistories: vi.fn()
}))
vi.mock('./PiRuntimeConnection', () => ({ PiRuntimeConnection: vi.fn() }))
vi.mock('./piFork', () => ({ forkPiSession: vi.fn() }))
vi.mock('./workspaceRelocation', () => ({ piWorkspaceRelocation: {} }))

const { PiRuntimeDriver } = await import('./PiRuntimeDriver')
const session = {
  id: 'session-1',
  agentId: 'agent-1',
  model: 'other::model-x',
  workspace: { path: '/data/Agents/system/2026-08-12/session-1', type: 'system' }
} as unknown as AgentSessionEntity

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAgent.mockReturnValue({ model: 'provider::model' })
  mocks.ensureRetiredHistory.mockResolvedValue(undefined)
  mocks.prepareWorkspace.mockResolvedValue(undefined)
})

describe('PiRuntimeDriver.validateSession native preflight', () => {
  it('ensures retired history before materializing the workspace', async () => {
    await new PiRuntimeDriver().validateSession(session)
    expect(mocks.ensureRetiredHistory).toHaveBeenCalledWith(session.id)
    expect(mocks.prepareWorkspace).toHaveBeenCalledWith(session)
    expect(mocks.ensureRetiredHistory.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepareWorkspace.mock.invocationCallOrder[0]
    )
  })

  it('accepts an interactive override when the agent default is cleared', async () => {
    mocks.getAgent.mockReturnValue({ model: null })
    await expect(new PiRuntimeDriver().validateSession(session)).resolves.toBeUndefined()
    expect(mocks.prepareWorkspace).toHaveBeenCalledWith(session)
  })

  it('rejects a headless run with no agent default despite a session override', async () => {
    mocks.getAgent.mockReturnValue({ model: null })
    await expect(new PiRuntimeDriver().validateSession(session, { headless: true })).rejects.toThrow(
      'has no model configured'
    )
    expect(mocks.prepareWorkspace).not.toHaveBeenCalled()
  })

  it('accepts a headless default when no session override exists', async () => {
    await expect(
      new PiRuntimeDriver().validateSession({ ...session, model: null }, { headless: true })
    ).resolves.toBeUndefined()
    expect(mocks.prepareWorkspace).toHaveBeenCalledWith(expect.objectContaining({ model: null }))
  })

  it('does not materialize a workspace after retired-history recovery fails', async () => {
    mocks.ensureRetiredHistory.mockRejectedValueOnce(new Error('migration unavailable'))
    await expect(new PiRuntimeDriver().validateSession(session)).rejects.toThrow('migration unavailable')
    expect(mocks.prepareWorkspace).not.toHaveBeenCalled()
  })
})
