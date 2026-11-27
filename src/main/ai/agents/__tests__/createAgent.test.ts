import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const {
  createAgentDataDirectory,
  removeAgentDataDirectory,
  createAgentWithId,
  syncHeartbeatSchedule,
  repairHeartbeatSchedules,
  reconcileAgent
} = vi.hoisted(() => ({
  createAgentDataDirectory: vi.fn(),
  removeAgentDataDirectory: vi.fn(),
  createAgentWithId: vi.fn(),
  syncHeartbeatSchedule: vi.fn(),
  repairHeartbeatSchedules: vi.fn(),
  reconcileAgent: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { createAgentWithId } }))
vi.mock('../agentDataDirectory', () => ({ createAgentDataDirectory, removeAgentDataDirectory }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AgentJobsService: { waitForHeartbeat: syncHeartbeatSchedule },
    ChannelManager: { reconcileAgent }
  } as never)
})
vi.mock('uuid', () => ({ v4: () => '11111111-1111-4111-8111-111111111111' }))

const { createAgent } = await import('../createAgent')

describe('createAgent', () => {
  const request = {
    type: 'claude-code' as const,
    name: 'Test',
    model: 'anthropic::claude-sonnet' as const
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(application.getPath).mockReturnValue('/tmp/agents')
    createAgentDataDirectory.mockResolvedValue('/tmp/agents/11111111-1111-4111-8111-111111111111')
    removeAgentDataDirectory.mockResolvedValue(undefined)
    createAgentWithId.mockImplementation((id: string, input: object) => ({ id, ...input }))
    syncHeartbeatSchedule.mockResolvedValue('created')
    repairHeartbeatSchedules.mockResolvedValue(undefined)
    reconcileAgent.mockImplementation(() => undefined)
  })

  it('provisions Agent data before committing the database row', async () => {
    await expect(createAgent(request)).resolves.toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Test'
    })
    expect(createAgentDataDirectory).toHaveBeenCalledWith('/tmp/agents', '11111111-1111-4111-8111-111111111111')
    expect(createAgentWithId).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', request)
    expect(createAgentDataDirectory.mock.invocationCallOrder[0]).toBeLessThan(
      createAgentWithId.mock.invocationCallOrder[0]
    )
  })

  it('removes the provisioned directory when the database write fails', async () => {
    createAgentWithId.mockImplementation(() => {
      throw new Error('database failed')
    })

    await expect(createAgent(request)).rejects.toThrow('database failed')
    expect(removeAgentDataDirectory).toHaveBeenCalledWith('/tmp/agents', '11111111-1111-4111-8111-111111111111')
  })

  it('does not write the database when directory provisioning fails', async () => {
    createAgentDataDirectory.mockRejectedValue(new Error('unsafe path'))

    await expect(createAgent(request)).rejects.toThrow('unsafe path')
    expect(createAgentWithId).not.toHaveBeenCalled()
  })

  it('returns only after heartbeat provisioning settles', async () => {
    let settle!: (value: string) => void
    syncHeartbeatSchedule.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          settle = resolve
        })
    )

    const pending = createAgent(request)
    const onSettled = vi.fn()
    void pending.then(onSettled)
    await new Promise((resolve) => setImmediate(resolve))
    expect(onSettled).not.toHaveBeenCalled()

    settle('created')
    await expect(pending).resolves.toMatchObject({ name: 'Test' })
    expect(syncHeartbeatSchedule).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
  })

  it('stays non-fatal when heartbeat provisioning fails, and keeps the failure per-agent', async () => {
    // No whole-population re-repair: the dominant failure is deterministic
    // (reserved-name conflict, untrusted path), which a retry cannot fix; the
    // next config save or startup sweep converges this one agent.
    syncHeartbeatSchedule.mockRejectedValue(new Error('disk full'))

    await expect(createAgent(request)).resolves.toMatchObject({
      id: '11111111-1111-4111-8111-111111111111'
    })
    expect(removeAgentDataDirectory).not.toHaveBeenCalled()
    expect(repairHeartbeatSchedules).not.toHaveBeenCalled()
  })

  describe('with channels', () => {
    const withChannels = {
      ...request,
      channels: [{ type: 'telegram' as const, name: 'Telegram', isActive: true, config: { bot_token: 't' } }]
    }

    it('starts the channels only after the Agent and its channels are committed', async () => {
      await createAgent(withChannels)

      expect(reconcileAgent).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
      expect(createAgentWithId.mock.invocationCallOrder[0]).toBeLessThan(reconcileAgent.mock.invocationCallOrder[0])
    })

    it('starts no channel when the database write fails', async () => {
      createAgentWithId.mockImplementation(() => {
        throw new Error('channel rejected')
      })

      await expect(createAgent(withChannels)).rejects.toThrow('channel rejected')
      expect(reconcileAgent).not.toHaveBeenCalled()
    })

    it('keeps the committed Agent when its channels fail to start', async () => {
      reconcileAgent.mockImplementation(() => {
        throw new Error('adapter failed')
      })

      await expect(createAgent(withChannels)).resolves.toMatchObject({ id: '11111111-1111-4111-8111-111111111111' })
      expect(removeAgentDataDirectory).not.toHaveBeenCalled()
    })
  })
})
