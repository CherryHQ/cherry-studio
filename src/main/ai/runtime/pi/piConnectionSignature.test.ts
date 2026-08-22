import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { CHERRY_CLOUD_MODEL_GROUP, CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAgent: vi.fn(),
  getProvider: vi.fn(),
  getModel: vi.fn(),
  getApiKeys: vi.fn(),
  listSkills: vi.fn(),
  listLocalSkillPaths: vi.fn(),
  getSkillDirectory: vi.fn(),
  findMcp: vi.fn(),
  listTools: vi.fn(),
  findBySessionId: vi.fn(),
  getTurnTrustedNotifyChannels: vi.fn(),
  usesPiGateway: vi.fn(),
  gatewayFingerprint: 'gateway-1'
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'McpCatalogService') return { listTools: mocks.listTools }
      if (name === 'AgentSessionRuntimeService') {
        return { getTurnTrustedNotifyChannels: mocks.getTurnTrustedNotifyChannels }
      }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: { getById: mocks.getSession } }))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mocks.getAgent } }))
vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: mocks.getProvider, getApiKeys: mocks.getApiKeys }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.getModel } }))
vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { findByIdOrName: mocks.findMcp } }))
vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { findBySessionId: mocks.findBySessionId }
}))
vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: {
    list: mocks.listSkills,
    listLocalSkillPaths: mocks.listLocalSkillPaths,
    getSkillDirectory: mocks.getSkillDirectory
  }
}))
vi.mock('@main/ai/runtime/agentApiGateway', () => ({
  gatewayCredentialsFingerprint: () => mocks.gatewayFingerprint
}))
vi.mock('@main/ai/runtime/pi/modelInjection', () => ({ usesPiGateway: mocks.usesPiGateway }))
const { capturePiConnectionSnapshot } = await import('./piConnectionSignature')

const agent = {
  id: 'agent-1',
  type: 'pi',
  model: 'provider::model',
  mcps: ['mcp-1'],
  knowledgeBaseIds: [],
  configuration: { permission_mode: 'acceptEdits' }
} as unknown as AgentEntity

beforeEach(() => {
  mocks.getAgent.mockReturnValue(agent)
  mocks.getSession.mockReturnValue({
    id: 'session-1',
    agentId: 'agent-1',
    workspaceId: 'workspace-1',
    workspace: { id: 'workspace-1', path: '/workspace', type: 'user' }
  })
  mocks.getProvider.mockResolvedValue({ id: 'provider', updatedAt: 1 })
  mocks.getModel.mockResolvedValue({ id: 'provider::model', updatedAt: 1 })
  mocks.getApiKeys.mockReturnValue([{ id: 'key-1', key: 'secret', enabled: true }])
  mocks.listSkills.mockResolvedValue([{ id: 'skill-1', isEnabled: true, updatedAt: 1 }])
  mocks.listLocalSkillPaths.mockResolvedValue([])
  mocks.getSkillDirectory.mockImplementation((folderName: string) => `/skills/${folderName}`)
  mocks.findMcp.mockReturnValue({ id: 'mcp-1', name: 'server', updatedAt: 1 })
  mocks.listTools.mockReturnValue([{ name: 'search', inputSchema: { type: 'object' } }])
  mocks.findBySessionId.mockReturnValue(null)
  mocks.getTurnTrustedNotifyChannels.mockReturnValue(undefined)
  mocks.usesPiGateway.mockReturnValue(false)
  mocks.gatewayFingerprint = 'gateway-1'
})

describe('capturePiConnectionSnapshot', () => {
  it('ignores the live permission mode but covers every reconcilable external input', async () => {
    const baseline = (await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')).signature
    mocks.getAgent.mockReturnValueOnce({
      ...agent,
      configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' }
    })
    const withPermissionChange = (await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')).signature
    expect(withPermissionChange).toBe(baseline)

    const mutations = [
      () => mocks.getAgent.mockReturnValueOnce({ ...agent, disabledTools: ['bash'] }),
      () =>
        mocks.getSession.mockReturnValueOnce({
          id: 'session-1',
          agentId: 'agent-1',
          workspaceId: 'workspace-2',
          workspace: { id: 'workspace-2', path: '/other', type: 'user' }
        }),
      () => mocks.getProvider.mockResolvedValueOnce({ id: 'provider', updatedAt: 2 }),
      () => mocks.getModel.mockResolvedValueOnce({ id: 'provider::model', updatedAt: 2 }),
      () => mocks.getApiKeys.mockReturnValueOnce([{ id: 'key-2', key: 'rotated', enabled: true }]),
      () => mocks.listSkills.mockResolvedValueOnce([{ id: 'skill-2', isEnabled: true, updatedAt: 1 }]),
      () => mocks.listLocalSkillPaths.mockResolvedValueOnce(['/workspace/.agents/skills/review']),
      () => mocks.findMcp.mockReturnValueOnce({ id: 'mcp-1', name: 'server', updatedAt: 2 }),
      () => mocks.listTools.mockReturnValueOnce([{ name: 'changed' }]),
      () => mocks.findBySessionId.mockReturnValueOnce({ id: 'channel-1', agentId: agent.id })
    ]

    for (const mutate of mutations) {
      mutate()
      await expect(capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')).resolves.not.toMatchObject({
        signature: baseline
      })
    }
  })

  it('returns the exact provider, model, skills, MCP, and channel facts signed by the snapshot', async () => {
    mocks.listSkills.mockResolvedValue([{ id: 'skill-1', folderName: 'pdf', isEnabled: true }])
    mocks.listLocalSkillPaths.mockResolvedValue(['/workspace/.agents/skills/review'])
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', type: 'telegram', agentId: agent.id })

    const snapshot = await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')

    expect(snapshot).toMatchObject({
      provider: { id: 'provider' },
      model: { id: 'provider::model' },
      enabledApiKeys: [{ id: 'key-1', key: 'secret', enabled: true }],
      additionalSkillPaths: ['/skills/pdf', '/workspace/.agents/skills/review'],
      linkedChannel: { id: 'channel-1', type: 'telegram' }
    })
    expect(snapshot.mcpServerSnapshots.get('mcp-1')).toMatchObject({ id: 'mcp-1', name: 'server' })
  })

  it('signs current turn notification recipients independent of input order', async () => {
    mocks.getTurnTrustedNotifyChannels.mockReturnValue([
      { id: 'channel-2', type: 'feishu' },
      { id: 'channel-1', type: 'telegram' }
    ])
    const first = await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')
    mocks.getTurnTrustedNotifyChannels.mockReturnValue([
      { id: 'channel-1', type: 'telegram' },
      { id: 'channel-2', type: 'feishu' }
    ])
    const reordered = await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')
    mocks.getTurnTrustedNotifyChannels.mockReturnValue([{ id: 'channel-3', type: 'telegram' }])
    const changed = await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')

    expect(reordered.signature).toBe(first.signature)
    expect(changed.signature).not.toBe(first.signature)
  })

  it('does not rebuild when unrelated source-channel fields change', async () => {
    mocks.findBySessionId.mockReturnValue({
      id: 'channel-1',
      type: 'telegram',
      agentId: agent.id,
      name: 'Before',
      activeChatIds: ['chat-1']
    })
    const first = await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')
    mocks.findBySessionId.mockReturnValue({
      id: 'channel-1',
      type: 'telegram',
      agentId: agent.id,
      name: 'After',
      activeChatIds: ['chat-1', 'chat-2']
    })

    const changed = await capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')

    expect(changed.signature).toBe(first.signature)
  })

  it('does not attach a session link owned by another agent', async () => {
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', agentId: 'agent-2' })

    await expect(capturePiConnectionSnapshot('session-1', agent.id, 'provider::model')).resolves.toMatchObject({
      linkedChannel: null
    })
  })

  it('rebuilds a Cloud route when the gateway connection identity changes', async () => {
    mocks.usesPiGateway.mockReturnValue(true)
    mocks.getProvider.mockResolvedValue({ id: CHERRY_CLOUD_PROVIDER_ID })
    mocks.getModel.mockResolvedValue({
      id: `${CHERRY_CLOUD_PROVIDER_ID}::deepseek-free`,
      providerId: CHERRY_CLOUD_PROVIDER_ID,
      group: CHERRY_CLOUD_MODEL_GROUP
    })
    const captureCloud = () =>
      capturePiConnectionSnapshot('session-1', agent.id, `${CHERRY_CLOUD_PROVIDER_ID}::deepseek-free`)
    const initialSignature = (await captureCloud()).signature

    mocks.gatewayFingerprint = 'gateway-2'

    expect((await captureCloud()).signature).not.toBe(initialSignature)
  })
})
