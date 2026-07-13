import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configure: vi.fn(),
  getInfo: vi.fn(),
  testConnection: vi.fn(),
  listRemoteAgents: vi.fn(),
  listLocalAgents: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { listAgents: mocks.listLocalAgents }
}))
vi.mock('@main/ai/runtime/stella/StellaConnectionService', () => ({
  stellaConnectionService: { configure: mocks.configure, getInfo: mocks.getInfo }
}))
vi.mock('@main/ai/runtime/stella/StellaClient', () => ({
  stellaClient: { testConnection: mocks.testConnection, listAgents: mocks.listRemoteAgents }
}))

const { stellaHandlers } = await import('../stella')

describe('stellaHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getInfo.mockReturnValue(null)
    mocks.listLocalAgents.mockReturnValue({ agents: [], total: 0 })
  })

  it('forwards the PAT only to configure and returns no credential', async () => {
    mocks.testConnection.mockResolvedValue({ endpoint: 'https://stella.example' })
    mocks.configure.mockReturnValue({ endpoint: 'https://stella.example', configured: true })
    await expect(
      stellaHandlers['stella.configure_connection']({ endpoint: 'https://stella.example', pat: 'secret' }, {} as never)
    ).resolves.toEqual({
      endpoint: 'https://stella.example',
      configured: true
    })
    expect(mocks.testConnection).toHaveBeenCalledWith('https://stella.example', 'secret')
    expect(mocks.configure).toHaveBeenCalledWith('https://stella.example', 'secret')
  })

  it('delegates list without a PAT-shaped renderer payload', async () => {
    mocks.listRemoteAgents.mockResolvedValue([{ id: 'a1', name: 'Remote' }])
    await expect(stellaHandlers['stella.list_agents'](undefined, {} as never)).resolves.toEqual([
      { id: 'a1', name: 'Remote' }
    ])
  })

  it('does not silently retarget existing references to another Stella server', async () => {
    mocks.testConnection.mockResolvedValue({ endpoint: 'https://new.example' })
    mocks.getInfo.mockReturnValue({ endpoint: 'https://old.example', configured: true })
    mocks.listLocalAgents.mockReturnValue({ agents: [{ type: 'stella' }], total: 1 })

    await expect(
      stellaHandlers['stella.configure_connection']({ endpoint: 'https://new.example', pat: 'secret' }, {} as never)
    ).rejects.toThrow('Remove existing Stella agent references')
    expect(mocks.configure).not.toHaveBeenCalled()
  })
})
