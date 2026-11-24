import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentSessionEntitySchema, type AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
const mocks = vi.hoisted(() => ({ agent: vi.fn(), workspace: vi.fn() }))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.agent } }))
vi.mock('@data/services/AgentSessionContextService', () => ({ agentSessionContextService: {} }))
vi.mock('@main/ai/agentSession/durableNativeContext', () => ({ openDurableStorage: vi.fn() }))
vi.mock('../agentSessionWorkspace', () => ({ prepareAgentSessionWorkspaceDirectory: mocks.workspace }))
vi.mock('./DurableBackend', () => ({ DurableBackend: {} }))
vi.mock('./durableContext', () => ({ prepareDurableBranch: vi.fn() }))
vi.mock('./durableFork', () => ({ forkDurable: vi.fn() }))
vi.mock('./PiDurableRuntimeConnection', () => ({ PiDurableRuntimeConnection: vi.fn() }))
import { PiDurableRuntimeDriver } from './PiDurableRuntimeDriver'
describe('Pi Durable effective model preflight', () => {
  const session: AgentSessionEntity = {
    id: 'session-1',
    agentId: 'agent-1',
    model: 'anthropic::override',
    name: 'Session',
    isNameManuallyEdited: false,
    workspaceId: 'workspace-1',
    workspace: {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp',
      type: 'user',
      orderKey: 'a0',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    orderKey: 'a0',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  it('uses a complete session entity fixture', () => {
    expect(AgentSessionEntitySchema.parse(session)).toEqual(session)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agent.mockReturnValue({ model: null })
    mocks.workspace.mockResolvedValue(undefined)
  })
  it('accepts an interactive override after the Agent default is deleted', async () => {
    await expect(new PiDurableRuntimeDriver().validateSession(session)).resolves.toBeUndefined()
    expect(mocks.workspace).toHaveBeenCalledWith(session)
  })
  it('rejects headless use of an override when the Agent default is deleted', async () => {
    await expect(new PiDurableRuntimeDriver().validateSession(session, { headless: true })).rejects.toThrow(
      'requires an agent, workspace and model'
    )
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('accepts a headless Agent default behind a session override', async () => {
    mocks.agent.mockReturnValue({ model: 'anthropic::default' })
    await expect(new PiDurableRuntimeDriver().validateSession(session, { headless: true })).resolves.toBeUndefined()
  })
  it('still requires the owning Agent', async () => {
    mocks.agent.mockReturnValue(undefined)
    await expect(new PiDurableRuntimeDriver().validateSession(session)).rejects.toThrow(
      'requires an agent, workspace and model'
    )
  })
})
