import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const {
  createAgentDataDirectory,
  removeAgentDataDirectory,
  createAgentWithId,
  syncHeartbeatSchedule,
  repairHeartbeatSchedules
} = vi.hoisted(() => ({
  createAgentDataDirectory: vi.fn(),
  removeAgentDataDirectory: vi.fn(),
  createAgentWithId: vi.fn(),
  syncHeartbeatSchedule: vi.fn(),
  repairHeartbeatSchedules: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { createAgentWithId } }))
vi.mock('../agentDataDirectory', () => ({ createAgentDataDirectory, removeAgentDataDirectory }))
vi.mock('../heartbeatSchedule', () => ({ syncHeartbeatSchedule, repairHeartbeatSchedules }))
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
    expect(onSettled).toHaveBeenCalled()
  })

  it('stays non-fatal when heartbeat provisioning fails, and triggers an eager re-repair', async () => {
    syncHeartbeatSchedule.mockRejectedValue(new Error('disk full'))

    await expect(createAgent(request)).resolves.toMatchObject({
      id: '11111111-1111-4111-8111-111111111111'
    })
    expect(removeAgentDataDirectory).not.toHaveBeenCalled()
    expect(repairHeartbeatSchedules).toHaveBeenCalledTimes(1)
  })
})
