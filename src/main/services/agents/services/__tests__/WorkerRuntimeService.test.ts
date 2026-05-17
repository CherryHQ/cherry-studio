import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

const mockListAgents = vi.fn()
const mockUpdateAgent = vi.fn()
const mockCreateAgent = vi.fn()
const mockCreateSession = vi.fn()
const mockGetModels = vi.fn()

vi.mock('../AgentService', () => ({
  agentService: {
    listAgents: (...args: unknown[]) => mockListAgents(...args),
    updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
    createAgent: (...args: unknown[]) => mockCreateAgent(...args)
  }
}))

vi.mock('../SessionService', () => ({
  sessionService: {
    createSession: (...args: unknown[]) => mockCreateSession(...args)
  }
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: (...args: unknown[]) => mockGetModels(...args)
  }
}))

import { WorkerRuntimeService } from '../WorkerRuntimeService'

describe('WorkerRuntimeService', () => {
  const service = WorkerRuntimeService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(service as any).startupReadyPromise = null
    vi.spyOn(service as never, 'probeCommand').mockResolvedValue({
      resolvedCommand: '/Applications/Claude.app/Contents/MacOS/claude',
      version: '2.1.128 (Claude Code)',
      status: 'online',
      heartbeatAt: '2026-05-07T00:00:00.000Z'
    })
  })

  it('shows discoverable worker families as online before any instance is bound', async () => {
    mockListAgents.mockResolvedValue({ total: 0, agents: [] })

    const database = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn().mockResolvedValue([])
          }))
        }))
      }))
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)
    vi.spyOn(service as never, 'probeCommand').mockImplementation(async (...args: unknown[]) => {
      const definition = args[0] as { type: string }
      return {
        resolvedCommand: definition.type === 'hermes' ? '/Users/mac/.local/bin/hermes' : undefined,
        version: definition.type === 'hermes' ? 'Hermes Agent v0.11.0' : undefined,
        status: definition.type === 'hermes' ? 'online' : 'missing_command',
        heartbeatAt: '2026-05-07T00:00:00.000Z',
        message: definition.type === 'hermes' ? undefined : '找不到命令'
      }
    })

    const workers = await service.listWorkers()
    const hermesFamily = workers.find((worker) => worker.type === 'hermes')
    const geminiFamily = workers.find((worker) => worker.type === 'gemini-cli')

    expect(hermesFamily?.status).toBe('online')
    expect(hermesFamily?.canRun).toBe(true)
    expect(hermesFamily?.instances).toHaveLength(0)
    expect(hermesFamily?.message).toContain('自动创建实例')
    expect(geminiFamily?.status).toBe('missing_command')
  })

  it('groups worker agents by family and exposes multiple long-lived instances', async () => {
    mockListAgents.mockResolvedValue({
      total: 3,
      agents: [
        {
          id: 'cherry-assistant-default',
          type: 'claude-code',
          name: 'Cherry Assistant',
          model: 'anthropic:claude-sonnet',
          accessible_paths: ['/tmp/project'],
          allowed_tools: [],
          mcps: [],
          configuration: {
            style_mode: 'normal'
          },
          created_at: '2026-05-07T00:00:00.000Z',
          updated_at: '2026-05-07T00:00:00.000Z'
        },
        {
          id: 'agent-primary',
          type: 'claude-code',
          name: 'Claude Code',
          model: 'anthropic:claude-sonnet',
          accessible_paths: ['/tmp/project'],
          allowed_tools: [],
          mcps: [],
          configuration: {
            worker_family: 'claude-code',
            worker_instance_role: 'primary',
            style_mode: 'normal'
          },
          created_at: '2026-05-07T00:00:00.000Z',
          updated_at: '2026-05-07T00:00:00.000Z'
        },
        {
          id: 'agent-member',
          type: 'claude-code',
          name: 'Claude Code 2',
          model: 'anthropic:claude-sonnet',
          accessible_paths: ['/tmp/project'],
          allowed_tools: [],
          mcps: [],
          configuration: {
            worker_family: 'claude-code',
            worker_instance_role: 'member',
            style_mode: 'creative'
          },
          created_at: '2026-05-07T00:00:00.000Z',
          updated_at: '2026-05-07T00:00:00.000Z'
        }
      ]
    })

    const database = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn().mockResolvedValue([{ workerAgentId: 'agent-member', count: 1 }])
          }))
        }))
      }))
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const workers = await service.listWorkers()
    const claudeFamily = workers.find((worker) => worker.type === 'claude-code')
    const codexFamily = workers.find((worker) => worker.type === 'codex')

    expect(codexFamily?.status).toBe('online')
    expect(claudeFamily?.instances).toHaveLength(2)
    expect(claudeFamily?.primaryInstanceId).toBe('agent-primary')
    expect(claudeFamily?.status).toBe('running')
    expect(claudeFamily?.workload.activeRuns).toBe(1)
    expect(claudeFamily?.version).toBe('2.1.128 (Claude Code)')
    expect(claudeFamily?.instances.map((instance) => instance.label)).toEqual(['Claude Code', 'Claude Code 2'])
  })

  it('binds Claude Code from taskbench without pre-existing private-chat agent', async () => {
    const createdAgent = {
      id: 'agent-claude-primary',
      type: 'claude-code',
      name: 'Claude Code',
      model: 'anthropic:claude-sonnet',
      accessible_paths: ['/tmp/project'],
      allowed_tools: [],
      mcps: [],
      configuration: {
        worker_family: 'claude-code',
        worker_instance_role: 'primary',
        style_mode: 'normal'
      },
      created_at: '2026-05-07T00:00:00.000Z',
      updated_at: '2026-05-07T00:00:00.000Z'
    }

    mockListAgents
      .mockResolvedValueOnce({ total: 0, agents: [] })
      .mockResolvedValueOnce({ total: 1, agents: [createdAgent] })
    mockGetModels.mockResolvedValue({ data: [{ id: 'anthropic:claude-sonnet' }] })
    mockCreateAgent.mockResolvedValue(createdAgent)
    mockCreateSession.mockResolvedValue({ id: 'session_1' })

    const database = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn().mockResolvedValue([])
          }))
        }))
      }))
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const family = await service.bindWorker('claude-code')

    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
    expect(mockCreateSession).toHaveBeenCalledWith('agent-claude-primary', {})
    expect(mockCreateAgent.mock.calls[0]?.[0]).toMatchObject({
      type: 'claude-code',
      model: 'anthropic:claude-sonnet',
      configuration: expect.objectContaining({
        permission_mode: 'bypassPermissions',
        worker_command: expect.stringContaining(
          '/Library/Application Support/Claude/claude-code/2.1.128/claude.app/Contents/MacOS/claude'
        )
      })
    })
    expect(family.version).toBe('2.1.128 (Claude Code)')
    expect(family.instances[0]?.agent.id).toBe('agent-claude-primary')
  })

  it('prepares all worker families on startup and persists detected worker models', async () => {
    mockListAgents.mockResolvedValue({ total: 0, agents: [] })
    mockUpdateAgent.mockResolvedValue(undefined)

    const fakeFamilies = [
      {
        key: 'hermes',
        type: 'hermes',
        label: 'Hermes',
        engine: 'Hermes CLI',
        defaultArgs: [],
        tags: [],
        status: 'online',
        healthLabel: '在线',
        canRun: true,
        workload: { activeRuns: 0, label: '空闲' },
        styleMode: 'normal',
        styleLabel: '正常模式',
        instances: [
          {
            agent: {
              id: 'agent-hermes',
              configuration: {
                worker_family: 'hermes',
                worker_instance_role: 'primary',
                worker_model_source: 'worker'
              }
            },
            modelManagedBy: 'worker',
            displayModelId: 'GLM-5.1',
            displayModelName: 'GLM-5.1'
          }
        ]
      }
    ] as any

    const bindSpy = vi.spyOn(service as never, 'bindWorker').mockResolvedValue(fakeFamilies[0])
    vi.spyOn(service as never, 'listWorkers')
      .mockResolvedValueOnce(fakeFamilies as never)
      .mockResolvedValueOnce(fakeFamilies as never)

    const families = await service.ensureStartupWorkersReady()

    expect(bindSpy).toHaveBeenCalledTimes(5)
    expect(bindSpy).toHaveBeenNthCalledWith(1, 'codex')
    expect(bindSpy).toHaveBeenNthCalledWith(2, 'opencode')
    expect(bindSpy).toHaveBeenNthCalledWith(3, 'claude-code')
    expect(bindSpy).toHaveBeenNthCalledWith(4, 'gemini-cli')
    expect(bindSpy).toHaveBeenNthCalledWith(5, 'hermes')
    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-hermes',
      expect.objectContaining({
        configuration: expect.objectContaining({
          worker_model_source: 'worker',
          worker_detected_model: 'GLM-5.1',
          worker_detected_model_name: 'GLM-5.1'
        })
      })
    )
    expect(families).toEqual(fakeFamilies)
  })
})
