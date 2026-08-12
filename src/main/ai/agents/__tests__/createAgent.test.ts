import { application } from '@application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createAgentDataDirectory,
  removeAgentDataDirectory,
  createAgentWithIdTx,
  emitAgentCreated,
  createSessionTx,
  notifyReadModelChange,
  uuidV4
} = vi.hoisted(() => ({
  createAgentDataDirectory: vi.fn(),
  removeAgentDataDirectory: vi.fn(),
  createAgentWithIdTx: vi.fn(),
  emitAgentCreated: vi.fn(),
  createSessionTx: vi.fn(),
  notifyReadModelChange: vi.fn(),
  uuidV4: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { createAgentWithIdTx, emitAgentCreated } }))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { createTx: createSessionTx, notifyReadModelChange }
}))
vi.mock('../agentDataDirectory', () => ({ createAgentDataDirectory, removeAgentDataDirectory }))
vi.mock('uuid', () => ({ v4: uuidV4 }))

const { createAgent } = await import('../createAgent')

const AGENT_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'

describe('createAgent', () => {
  const request = {
    type: 'claude-code' as const,
    name: 'Test',
    model: 'anthropic::claude-sonnet' as const
  }

  beforeEach(() => {
    vi.clearAllMocks()
    let issued = 0
    uuidV4.mockImplementation(() => [AGENT_ID, SESSION_ID][issued++])
    vi.mocked(application.getPath).mockReturnValue('/tmp/agents')
    createAgentDataDirectory.mockResolvedValue(`/tmp/agents/${AGENT_ID}`)
    removeAgentDataDirectory.mockResolvedValue(undefined)
    createAgentWithIdTx.mockImplementation((_tx: unknown, id: string, input: object) => ({ id, ...input }))
  })

  it('provisions Agent data before committing the database row', async () => {
    await expect(createAgent(request)).resolves.toMatchObject({ id: AGENT_ID, name: 'Test' })
    expect(createAgentDataDirectory).toHaveBeenCalledWith('/tmp/agents', AGENT_ID)
    expect(createAgentWithIdTx).toHaveBeenCalledWith(expect.anything(), AGENT_ID, request)
    expect(createAgentDataDirectory.mock.invocationCallOrder[0]).toBeLessThan(
      createAgentWithIdTx.mock.invocationCallOrder[0]
    )
  })

  it('seeds the first session inside the same write transaction as the agent row', async () => {
    await createAgent(request)

    const [tx, sessionId, dto] = createSessionTx.mock.calls[0]
    expect(tx).toBe(createAgentWithIdTx.mock.calls[0][0])
    expect(sessionId).toBe(SESSION_ID)
    expect(dto).toEqual({ agentId: AGENT_ID, name: '', workspace: { type: 'system' } })
    // Renderers must not be told about either row before the transaction commits.
    expect(emitAgentCreated.mock.invocationCallOrder[0]).toBeGreaterThan(createSessionTx.mock.invocationCallOrder[0])
    expect(notifyReadModelChange).toHaveBeenCalledWith([sessionId], 'membership')
  })

  it('removes the provisioned directory when the database write fails', async () => {
    createAgentWithIdTx.mockImplementation(() => {
      throw new Error('database failed')
    })

    await expect(createAgent(request)).rejects.toThrow('database failed')
    expect(removeAgentDataDirectory).toHaveBeenCalledWith('/tmp/agents', AGENT_ID)
  })

  it('does not announce the agent when its first session cannot be seeded', async () => {
    createSessionTx.mockImplementation(() => {
      throw new Error('session insert failed')
    })

    await expect(createAgent(request)).rejects.toThrow('session insert failed')
    expect(removeAgentDataDirectory).toHaveBeenCalledWith('/tmp/agents', AGENT_ID)
    expect(emitAgentCreated).not.toHaveBeenCalled()
  })

  it('does not write the database when directory provisioning fails', async () => {
    createAgentDataDirectory.mockRejectedValue(new Error('unsafe path'))

    await expect(createAgent(request)).rejects.toThrow('unsafe path')
    expect(createAgentWithIdTx).not.toHaveBeenCalled()
  })
})
