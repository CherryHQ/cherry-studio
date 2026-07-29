import { application } from '@application'
import { MockMainProfileWriteBarrierServiceUtils } from '@test-mocks/main/ProfileWriteBarrierService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAgentDataDirectory, removeAgentDataDirectory, createAgentWithId } = vi.hoisted(() => ({
  createAgentDataDirectory: vi.fn(),
  removeAgentDataDirectory: vi.fn(),
  createAgentWithId: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { createAgentWithId } }))
vi.mock('../agentDataDirectory', () => ({ createAgentDataDirectory, removeAgentDataDirectory }))
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
    MockMainProfileWriteBarrierServiceUtils.resetMocks()
    vi.mocked(application.getPath).mockReturnValue('/tmp/agents')
    createAgentDataDirectory.mockResolvedValue('/tmp/agents/11111111-1111-4111-8111-111111111111')
    removeAgentDataDirectory.mockResolvedValue(undefined)
    createAgentWithId.mockImplementation((id: string, input: object) => ({ id, ...input }))
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
    expect(application.get('ProfileWriteBarrierService').runWrite).toHaveBeenCalledWith(
      'agent:create',
      expect.any(Function)
    )
  })

  it('waits for profile write admission before provisioning the directory or database row', async () => {
    let admit!: () => void
    const admitted = new Promise<void>((resolve) => {
      admit = resolve
    })
    vi.mocked(application.get('ProfileWriteBarrierService').runWrite).mockImplementationOnce(
      async (_label, operation) => {
        await admitted
        return operation()
      }
    )

    const pending = createAgent(request)
    await Promise.resolve()

    expect(createAgentDataDirectory).not.toHaveBeenCalled()
    expect(createAgentWithId).not.toHaveBeenCalled()

    admit()
    await pending

    expect(createAgentDataDirectory).toHaveBeenCalledOnce()
    expect(createAgentWithId).toHaveBeenCalledOnce()
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
})
