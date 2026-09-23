import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { StreamListener } from '@main/ai/streamManager'
import { BaseService } from '@main/core/lifecycle'
import type { DoctorReport } from '@shared/types/doctor'
import { doctorAgentStateCacheKey, doctorStateCacheKey } from '@shared/utils/doctor'

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  ensureBuiltinAgent: vi.fn(),
  updateAgent: vi.fn(),
  createSession: vi.fn(),
  startRun: vi.fn(),
  applyWrite: vi.fn(),
  undoWrite: vi.fn()
}))

vi.mock('@application', async () =>
  (await import('@test-mocks/main/application')).mockApplicationFactory({
    AiStreamManager: { abort: mocks.abort }
  } as never)
)
vi.mock('@data/services/AgentService', () => ({
  agentService: { ensureBuiltinAgent: mocks.ensureBuiltinAgent, updateAgent: mocks.updateAgent }
}))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: { create: mocks.createSession } }))
vi.mock('@main/ai/agents/ensureBuiltinAgent', () => ({ loadBuiltinAgentEnsureInput: () => ({}) }))
vi.mock('@main/ai/streamManager', () => ({ startAgentSessionRun: mocks.startRun }))
vi.mock('@main/i18n', () => ({ getAppLanguage: () => 'en-US' }))
vi.mock('@main/ai/agents/doctor/doctorWrites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/ai/agents/doctor/doctorWrites')>()),
  applyWrite: mocks.applyWrite,
  undoWrite: mocks.undoWrite
}))

const { DoctorAgentService } = await import('../DoctorAgentService')

const report: DoctorReport = {
  schemaVersion: 1,
  runId: 'report-1',
  scope: 'global',
  tier: 'quick',
  selectedCheckIds: ['network-online'],
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  basics: {
    version: '2.0.0',
    edition: 'global',
    channel: 'latest',
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '25',
    runtime: {},
    isPackaged: false,
    isPortable: false,
    userDataPath: '/tmp/doctor'
  },
  results: [{ id: 'network-online', status: 'pass', durationMs: 1 }],
  summary: { pass: 1, warn: 0, fail: 0, skip: 0, error: 0 }
}

const agentState = () => application.get('CacheService').getShared(doctorAgentStateCacheKey('global'))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let listener: StreamListener | undefined

beforeEach(() => {
  vi.clearAllMocks()
  MockMainCacheServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  BaseService.resetInstances()
  listener = undefined
  application.get('CacheService').setShared(doctorStateCacheKey('global'), { status: 'completed', report })
  mocks.ensureBuiltinAgent.mockReturnValue({ id: 'doctor-agent', model: 'openai::gpt-4o' })
  mocks.createSession.mockReturnValue({ id: 'session-1' })
  mocks.startRun.mockImplementation(async (input: { listeners: StreamListener[] }) => {
    listener = input.listeners[0]
    return { mode: 'started' }
  })
})

async function startedService() {
  const service = new DoctorAgentService()
  const started = await service.start({ scope: 'global', reportRunId: 'report-1' })
  expect(started.status).toBe('started')
  return { service, runId: (started as { runId: string }).runId }
}

describe('DoctorAgentService.start', () => {
  it('refuses a report the user is no longer looking at', async () => {
    const service = new DoctorAgentService()
    expect(await service.start({ scope: 'global', reportRunId: 'older-run' })).toEqual({ status: 'stale' })
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(agentState()).toBeUndefined()
  })

  it('runs one hidden headless session per scope and streams the reply into the shared state', async () => {
    const { service, runId } = await startedService()
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'doctor-agent' }), 'background')
    expect(mocks.startRun).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', headless: true }))
    expect(await service.start({ scope: 'global', reportRunId: 'report-1' })).toEqual({ status: 'busy', runId })

    listener!.onChunk({ type: 'tool-input-start', toolCallId: 't1', toolName: 'mcp__doctor__data_api' })
    listener!.onChunk({ type: 'text-delta', id: 'm1', delta: 'Proxy is ' })
    listener!.onChunk({ type: 'text-delta', id: 'm1', delta: 'misconfigured.' })
    await wait(250)
    expect(agentState()).toMatchObject({
      status: 'running',
      text: 'Proxy is misconfigured.',
      toolCalls: ['mcp__doctor__data_api']
    })

    await listener!.onDone({ status: 'success' })
    expect(agentState()).toMatchObject({ status: 'completed', runId, text: 'Proxy is misconfigured.' })
    expect(listener!.isAlive()).toBe(false)
  })

  it('reports a missing model instead of starting a session', async () => {
    mocks.ensureBuiltinAgent.mockReturnValue({ id: 'doctor-agent', model: null })
    const service = new DoctorAgentService()
    expect(await service.start({ scope: 'global', reportRunId: 'report-1' })).toEqual({ status: 'no_model' })
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('cancel aborts the stream and settles the state', async () => {
    const { service, runId } = await startedService()
    expect(service.cancel('global', runId)).toEqual({ status: 'canceled' })
    expect(mocks.abort).toHaveBeenCalledWith('agent-session:session-1', expect.stringContaining('canceled'))
    expect(agentState()).toMatchObject({ status: 'canceled', runId })
    expect(service.cancel('global', runId)).toEqual({ status: 'not_running' })
  })
})

describe('DoctorAgentService writes', () => {
  it('queues confirm-tier writes as proposals, applies them on request and undoes them from the ledger', async () => {
    const { service, runId } = await startedService()
    mocks.applyWrite.mockResolvedValue({ before: { apiHost: 'https://old' }, undoable: true })
    const write = { kind: 'data_api_patch', path: '/providers/openai', body: { apiHost: 'https://new' } } as const

    const outcome = await service.requestWrite('session-1', write, 'Fix the base URL')
    expect(outcome.status).toBe('proposed')
    expect(mocks.applyWrite).not.toHaveBeenCalled()
    const proposalId = (outcome as { proposal: { id: string } }).proposal.id
    expect(agentState()).toMatchObject({
      proposals: [{ id: proposalId, status: 'pending', summary: 'Fix the base URL' }]
    })

    const applied = await service.apply({ scope: 'global', runId, proposalId })
    expect(applied.status).toBe('applied')
    expect(mocks.applyWrite).toHaveBeenCalledWith(write)
    const changeId = (applied as { change: { id: string } }).change.id
    expect(agentState()).toMatchObject({
      proposals: [{ id: proposalId, status: 'applied' }],
      changes: [{ id: changeId, before: { apiHost: 'https://old' }, undoable: true, undone: false }]
    })
    expect(await service.apply({ scope: 'global', runId, proposalId })).toEqual({ status: 'stale' })

    const undone = await service.undo({ scope: 'global', runId, changeId })
    expect(undone.status).toBe('undone')
    expect(mocks.undoWrite).toHaveBeenCalledWith(write, { apiHost: 'https://old' })
    expect(agentState()).toMatchObject({ changes: [{ id: changeId, undone: true }] })
    expect(await service.undo({ scope: 'global', runId, changeId })).toEqual({ status: 'stale' })
  })

  it('runs a low-risk catalog fix immediately and records it as not undoable', async () => {
    const { service } = await startedService()
    mocks.applyWrite.mockResolvedValue({ before: null, undoable: false, fix: { status: 'fixed', result: {} } })
    const outcome = await service.requestWrite(
      'session-1',
      {
        kind: 'doctor_fix',
        request: {
          scope: 'global',
          runId: 'report-1',
          checkId: 'mcp-servers-connected',
          fixId: 'restart',
          target: 's1'
        }
      },
      'Restart the MCP server'
    )
    expect(outcome.status).toBe('applied')
    expect(mocks.applyWrite).toHaveBeenCalledTimes(1)
    expect(agentState()).toMatchObject({
      proposals: [],
      changes: [{ undoable: false, summary: 'Restart the MCP server' }]
    })
  })

  it('surfaces a failed write to the model without touching the ledger', async () => {
    const { service } = await startedService()
    mocks.applyWrite.mockRejectedValue(new Error('MCP runtime is not ready'))
    const outcome = await service.requestWrite(
      'session-1',
      {
        kind: 'doctor_fix',
        request: {
          scope: 'global',
          runId: 'report-1',
          checkId: 'mcp-servers-connected',
          fixId: 'restart',
          target: 's1'
        }
      },
      'Restart'
    )
    expect(outcome).toEqual({ status: 'failed', message: 'MCP runtime is not ready' })
    expect(agentState()).toMatchObject({ changes: [] })
  })

  it('rejects writes from a session that is not an active analysis', async () => {
    const service = new DoctorAgentService()
    await expect(
      service.requestWrite('stranger', { kind: 'preference_set', key: 'app.proxy.mode', value: 'none' }, 'x')
    ).rejects.toThrow('not an active doctor analysis')
  })
})
