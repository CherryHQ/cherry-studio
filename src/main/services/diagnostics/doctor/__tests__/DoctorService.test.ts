import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { BaseService } from '@main/core/lifecycle'
import type { DoctorScopeKey } from '@shared/types/doctor'
import { doctorStateCacheKey } from '@shared/utils/doctor'

import type { DoctorContext } from '../types'

const registryMocks = vi.hoisted(() => ({
  bootConfigRun: vi.fn(),
  bootConfigRepair: vi.fn(),
  hardwareAccelerationRun: vi.fn(),
  mcpConnectedRun: vi.fn(),
  mcpRestart: vi.fn(),
  userDataRun: vi.fn(),
  sharedProbe: vi.fn(),
  modelEndpointRun: vi.fn(),
  modelListRun: vi.fn(),
  modelConversationRun: vi.fn(),
  modelConversationConfirm: vi.fn(),
  providerApiKeyRun: vi.fn()
}))

vi.mock('../registry', async () => {
  const { sharedProbe } = registryMocks
  // Two network checks in different prerequisite layers that both read one shared probe.
  const sharing = async (ctx: DoctorContext) => {
    await ctx.share('network:diagnoses', sharedProbe)
    return { status: 'pass' }
  }
  return {
    doctorCheckRegistry: {
      'config-boot-config-valid': {
        id: 'config-boot-config-valid',
        run: registryMocks.bootConfigRun,
        fixes: { repair: registryMocks.bootConfigRepair }
      },
      'storage-userdata-location': { id: 'storage-userdata-location', run: registryMocks.userDataRun, fixes: {} },
      'config-hardware-acceleration': {
        id: 'config-hardware-acceleration',
        run: registryMocks.hardwareAccelerationRun,
        fixes: {}
      },
      'mcp-servers-connected': {
        id: 'mcp-servers-connected',
        run: registryMocks.mcpConnectedRun,
        fixes: { restart: registryMocks.mcpRestart }
      },
      'provider-model': { id: 'provider-model', run: async () => ({ status: 'pass' }), fixes: {} },
      'provider-api-key-present': { id: 'provider-api-key-present', run: registryMocks.providerApiKeyRun, fixes: {} },
      'network-online': { id: 'network-online', run: sharing, fixes: {} },
      'network-dns-resolution': { id: 'network-dns-resolution', run: sharing, fixes: {} },
      'network-model-endpoint': { id: 'network-model-endpoint', run: registryMocks.modelEndpointRun, fixes: {} },
      'provider-model-list': { id: 'provider-model-list', run: registryMocks.modelListRun, fixes: {} },
      'provider-model-conversation': {
        id: 'provider-model-conversation',
        run: registryMocks.modelConversationRun,
        getConfirmation: registryMocks.modelConversationConfirm,
        fixes: {}
      }
    }
  }
})
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

const { DoctorService } = await import('../DoctorService')

function createReadyService() {
  class ReadyDoctor extends DoctorService {
    constructor() {
      super()
      this.onAllReady()
    }
  }
  return new ReadyDoctor()
}

// The registry mock implements only a few checks; the catalog lists more.
const MOCKED = ['config-boot-config-valid', 'storage-userdata-location'] as const

const stateOf = (scope: DoctorScopeKey) => application.get('CacheService').getShared(doctorStateCacheKey(scope))
const state = () => stateOf('global')
const warnWithRepair = {
  status: 'warn',
  attribution: 'user-fixable',
  detail: { variant: 'invalid_keys' },
  actions: [{ kind: 'fix', fixId: 'repair' }]
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainCacheServiceUtils.resetMocks()
  BaseService.resetInstances()
  registryMocks.bootConfigRun.mockResolvedValue({ status: 'pass' })
  registryMocks.hardwareAccelerationRun.mockResolvedValue({ status: 'pass' })
  registryMocks.mcpConnectedRun.mockResolvedValue({ status: 'pass' })
  registryMocks.userDataRun.mockResolvedValue({ status: 'pass' })
  registryMocks.sharedProbe.mockResolvedValue([])
  registryMocks.modelEndpointRun.mockResolvedValue({ status: 'pass' })
  registryMocks.modelListRun.mockResolvedValue({ status: 'pass' })
  registryMocks.modelConversationRun.mockResolvedValue({ status: 'pass' })
  registryMocks.providerApiKeyRun.mockResolvedValue({ status: 'pass' })
  registryMocks.modelConversationConfirm.mockResolvedValue({
    confirmation: {
      messageKey: 'settings.doctor.checks.provider-model-conversation.confirmation',
      params: { model: 'gpt-4o', modelId: 'gpt-4o', endpoint: 'https://example.test' }
    },
    isCurrent: () => true
  })
})

describe('DoctorContext.share', () => {
  it('keeps the default model identity stable while settings change during a run', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'openai::old')
    registryMocks.bootConfigRun.mockImplementation(async (ctx: DoctorContext) => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'openai::new')
      const { defaultChatModel } = await import('../subjectDefaults')
      const model = await defaultChatModel(ctx)
      return { status: 'pass', evidence: [{ key: 'model', value: model?.modelId, dataClass: 'public' }] }
    })
    const run = await createReadyService().run({
      subject: { kind: 'global' },
      tier: 'quick',
      checkIds: ['config-boot-config-valid']
    })
    expect(run).toMatchObject({
      status: 'completed',
      report: { results: [{ evidence: [{ key: 'model', value: 'old' }] }] }
    })
  })

  const SHARING = ['network-online', 'network-dns-resolution'] as const

  it('runs a shared probe once per run even for checks in different layers', async () => {
    const service = createReadyService()
    const outcome = await service.run({ subject: { kind: 'global' }, tier: 'live', checkIds: SHARING })
    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.summary).toMatchObject({ pass: 2 })
    expect(registryMocks.sharedProbe).toHaveBeenCalledTimes(1)
  })

  it('probes afresh for every new run', async () => {
    const service = createReadyService()
    await service.run({ subject: { kind: 'global' }, tier: 'live', checkIds: SHARING })
    await service.run({ subject: { kind: 'global' }, tier: 'live', checkIds: SHARING })
    expect(registryMocks.sharedProbe).toHaveBeenCalledTimes(2)
  })
})

describe('DoctorService.run', () => {
  it('rejects an explicit check outside the tier without replacing the last report', async () => {
    const service = createReadyService()
    const previous = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    if (previous.status !== 'completed') throw new Error('expected report')
    await expect(
      service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: ['network-dns-resolution'] })
    ).rejects.toThrow('unavailable in tier quick')
    expect(state()).toEqual({ status: 'completed', report: previous.report })
  })

  it('rejects early calls without publishing a running state', async () => {
    await expect(
      new DoctorService().run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    ).rejects.toThrow('not ready')
    expect(state()?.status).not.toBe('running')
  })

  it('includes transitive dependencies for selected checks', async () => {
    const result = await createReadyService().run({
      subject: { kind: 'global' },
      tier: 'live',
      checkIds: ['network-dns-resolution']
    })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.report.results.map((item) => item.id)).toEqual(['network-dns-resolution', 'network-online'])
  })

  it('rejects a tier mismatch before publishing running', async () => {
    await expect(
      createReadyService().run({ subject: { kind: 'global' }, tier: 'quick', checkIds: ['network-dns-resolution'] })
    ).rejects.toThrow('tier')
    expect(state()?.status).not.toBe('running')
  })

  it('ends running when collection of the report fails', async () => {
    const service = createReadyService()
    vi.spyOn(service as unknown as { collectBasics(): Promise<never> }, 'collectBasics').mockRejectedValueOnce(
      new Error('read failed')
    )
    await expect(service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })).rejects.toThrow(
      'read failed'
    )
    expect(state()).toMatchObject({ status: 'failed', selectedCheckIds: MOCKED })
    expect((await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })).status).toBe(
      'completed'
    )
  })
  it('publishes running progress and then the completed report on the shared cache', async () => {
    const service = createReadyService()
    const outcome = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.summary).toEqual({ pass: 2, warn: 0, fail: 0, skip: 0, error: 0 })
    expect(outcome.report.selectedCheckIds).toEqual(MOCKED)
    expect(outcome.report.basics).toMatchObject({
      edition: 'global',
      channel: 'latest',
      userDataPath: '/mock/app.userdata'
    })
    expect(new Date(outcome.report.expiresAt).getTime()).toBeGreaterThan(new Date(outcome.report.finishedAt).getTime())
    expect(state()).toEqual({ status: 'completed', report: outcome.report })

    const published = vi.mocked(application.get('CacheService').setShared).mock.calls.map(([, value]) => value)
    expect(published[0]).toMatchObject({
      status: 'running',
      selectedCheckIds: MOCKED,
      results: [],
      activeCheckIds: []
    })
    expect(published).toContainEqual(
      expect.objectContaining({
        status: 'running',
        activeCheckIds: expect.arrayContaining(['config-boot-config-valid'])
      })
    )
    expect(published).toContainEqual(
      expect.objectContaining({ status: 'running', results: [expect.objectContaining({ status: 'pass' })] })
    )

    expect(published.at(-1)).toEqual({ status: 'completed', report: outcome.report })
  })

  it('counts a repeated check once', async () => {
    const service = createReadyService()
    const outcome = await service.run({
      subject: { kind: 'global' },
      tier: 'quick',
      checkIds: ['config-boot-config-valid', 'config-boot-config-valid']
    })

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.results).toHaveLength(1)
    expect(outcome.report.summary).toMatchObject({ pass: 1 })
  })

  it('aborts an in-flight run when the service stops', async () => {
    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const service = createReadyService()

    const run = service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    ;(service as unknown as { onStop(): void }).onStop()
    release()

    await expect(run).resolves.toMatchObject({ status: 'canceled' })
  })

  it('answers busy with the in-flight run id, and that id can cancel the run', async () => {
    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const service = createReadyService()

    const first = service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    const busy = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    expect(busy.status).toBe('busy')
    if (busy.status !== 'busy') return
    expect(service.cancel('global', 'someone-else')).toEqual({ status: 'not_running' })
    expect(service.cancel('global', busy.runId)).toEqual({ status: 'canceled' })
    release()
    await expect(first).resolves.toEqual({ status: 'canceled', runId: busy.runId })
    expect(state()).toEqual({ status: 'canceled', runId: busy.runId, selectedCheckIds: MOCKED })
  })
})

describe('DoctorService scopes', () => {
  const dbh = setupTestDatabase()
  const chat = { kind: 'chat', providerId: 'openai', modelId: 'gpt-4o' } as const

  it('keeps a contextual run in its own scope, leaving the global report untouched', async () => {
    const service = createReadyService()
    const global = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    const scoped = await service.run({ tier: 'quick', subject: chat, checkIds: ['network-online'] })
    if (global.status !== 'completed' || scoped.status !== 'completed') throw new Error('expected reports')

    expect(scoped.report.scope).toBe('chat:openai/gpt-4o')
    expect(stateOf('chat:openai/gpt-4o')).toEqual({ status: 'completed', report: scoped.report })
    expect(state()).toEqual({ status: 'completed', report: global.report })
  })

  it('lets a contextual run start while the global run is still in flight', async () => {
    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const service = createReadyService()

    const global = service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    await expect(service.run({ tier: 'quick', subject: chat, checkIds: ['network-online'] })).resolves.toMatchObject({
      status: 'completed'
    })
    release()
    await global
  })

  it('refuses a check whose scope the subject does not satisfy, before publishing anything', async () => {
    await expect(
      createReadyService().run({ tier: 'quick', subject: chat, checkIds: ['config-boot-config-valid'] })
    ).rejects.toThrow('does not apply')
    expect(stateOf('chat:openai/gpt-4o')).toBeUndefined()
  })

  it('adds model connectivity to a conversation diagnosis without a full live sweep', async () => {
    const started = await createReadyService().runContextualDiagnosis(chat)
    if (started.status !== 'completed') throw new Error('expected report')
    const ids = [
      ...started.report.results.map((entry) => entry.id),
      ...(started.report.pendingChecks ?? []).map((pending) => pending.checkId)
    ]
    expect(ids).toEqual(
      expect.arrayContaining([
        'network-online',
        'network-model-endpoint',
        'provider-model-list',
        'provider-model-conversation'
      ])
    )
    expect(ids).not.toContain('network-dns-resolution')
    expect(ids).not.toContain('config-boot-config-valid')
    expect(registryMocks.modelConversationRun).not.toHaveBeenCalled()
    expect(started.report.pendingChecks).toEqual([expect.objectContaining({ checkId: 'provider-model-conversation' })])
    expect(started.report.selectedCheckIds).toEqual(expect.arrayContaining(ids))
  })

  it('diagnoses the real Agent model and MCP membership, and refuses a removed association', async () => {
    dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'a1',
        name: 'Agent',
        instructions: '',
        type: 'claude-code',
        model: 'openai::gpt-4o',
        orderKey: 'a0'
      })
      .run()
    dbh.db.insert(mcpServerTable).values({ id: 'srv-1', name: 'MCP', isActive: true }).run()
    dbh.db.insert(agentMcpServerTable).values({ agentId: 'a1', mcpServerId: 'srv-1' }).run()
    registryMocks.mcpConnectedRun.mockImplementation(async ({ subject }: DoctorContext) => ({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'server_errors', params: { count: 1 } },
      actions: [{ kind: 'fix', fixId: 'restart', target: subject?.mcpServerIds?.[0] }],
      evidence: [{ key: 'model', value: `${subject?.providerId}/${subject?.modelId}`, dataClass: 'local_only' }]
    }))
    const service = createReadyService()
    const run = await service.run({
      tier: 'quick',
      subject: { kind: 'agent', agentId: 'a1' },
      checkIds: ['mcp-servers-connected']
    })
    if (run.status !== 'completed') throw new Error('Expected report')
    expect(run.report.results[0]).toMatchObject({
      actions: [{ kind: 'fix', fixId: 'restart', target: 'srv-1' }],
      evidence: [{ key: 'model', value: 'openai/gpt-4o' }]
    })
    dbh.db.delete(agentMcpServerTable).where(eq(agentMcpServerTable.agentId, 'a1')).run()
    await expect(
      service.fix({
        scope: 'agent:a1',
        runId: run.report.runId,
        checkId: 'mcp-servers-connected',
        fixId: 'restart',
        target: 'srv-1'
      })
    ).resolves.toEqual({ status: 'stale', reason: 'finding_changed' })
    expect(registryMocks.mcpRestart).not.toHaveBeenCalled()
  })

  it('pins an Agent conversation model so a later model switch does not reuse the first report', async () => {
    dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'a-pin',
        name: 'Pinned',
        instructions: '',
        type: 'claude-code',
        model: 'openai::gpt-4o',
        orderKey: 'a0'
      })
      .run()
    dbh.db.insert(mcpServerTable).values({ id: 'srv-pin', name: 'MCP', isActive: true }).run()
    dbh.db.insert(agentMcpServerTable).values({ agentId: 'a-pin', mcpServerId: 'srv-pin' }).run()
    registryMocks.mcpConnectedRun.mockImplementation(async ({ subject }: DoctorContext) => ({
      status: 'pass',
      evidence: [{ key: 'model', value: `${subject?.providerId}/${subject?.modelId}`, dataClass: 'local_only' }]
    }))
    const service = createReadyService()
    const first = await service.run({
      tier: 'quick',
      subject: { kind: 'agent', agentId: 'a-pin', providerId: 'deepseek', modelId: 'deepseek-v4-flash' },
      checkIds: ['mcp-servers-connected']
    })
    const second = await service.run({
      tier: 'quick',
      subject: { kind: 'agent', agentId: 'a-pin', providerId: 'deepseek', modelId: 'deepseek-reasoner' },
      checkIds: ['mcp-servers-connected']
    })
    if (first.status !== 'completed' || second.status !== 'completed') throw new Error('Expected reports')
    expect(first.report.scope).toBe('agent:a-pin:deepseek/deepseek-v4-flash')
    expect(second.report.scope).toBe('agent:a-pin:deepseek/deepseek-reasoner')
    expect(first.report.results[0].evidence).toEqual([
      { key: 'model', value: 'deepseek/deepseek-v4-flash', dataClass: 'local_only' }
    ])
    expect(second.report.results[0].evidence).toEqual([
      { key: 'model', value: 'deepseek/deepseek-reasoner', dataClass: 'local_only' }
    ])
  })

  it('gives a global run no subject, so parameterised checks fall back to defaults', async () => {
    const service = createReadyService()
    await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: ['mcp-servers-connected'] })
    expect(registryMocks.mcpConnectedRun).toHaveBeenCalledWith(expect.objectContaining({ subject: null }))
  })

  it('refuses a fix addressed to a scope other than the report it names', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    const service = createReadyService()
    const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    await expect(
      service.fix({
        scope: 'chat:openai/gpt-4o',
        runId: run.report.runId,
        checkId: 'config-boot-config-valid',
        fixId: 'repair'
      })
    ).resolves.toEqual({ status: 'stale', reason: 'run_superseded' })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })
})

describe('DoctorService.fix', () => {
  it.each(['absent', 'passed', 'not offered'] as const)(
    'refuses a repair whose original finding was %s',
    async (finding) => {
      const service = createReadyService()
      if (finding === 'not offered') registryMocks.bootConfigRun.mockResolvedValue({ ...warnWithRepair, actions: [] })
      const run = await service.run({
        subject: { kind: 'global' },
        tier: 'quick',
        checkIds: finding === 'absent' ? ['storage-userdata-location'] : MOCKED
      })
      if (run.status !== 'completed') throw new Error('expected report')
      registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
      await expect(
        service.fix({ scope: 'global', runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
      ).resolves.toMatchObject({ status: 'stale', reason: 'finding_changed' })
      expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
      expect(state()).toEqual({ status: 'completed', report: run.report })
    }
  )

  it('rejects expired reports without performing a fix', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    const service = createReadyService()
    const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected report')
    application.get('CacheService').setShared(doctorStateCacheKey('global'), {
      status: 'completed',
      report: { ...run.report, expiresAt: new Date(0).toISOString() }
    })
    await expect(
      service.fix({ scope: 'global', runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    ).resolves.toEqual({ status: 'stale', reason: 'report_expired' })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it.each(['superseded', 'expired'] as const)(
    'revalidates a report %s during re-probe and excludes concurrent work',
    async (change) => {
      registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
      const service = createReadyService()
      const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
      if (run.status !== 'completed') throw new Error('expected report')
      let release!: (value: typeof warnWithRepair) => void
      registryMocks.bootConfigRun.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        })
      )
      const request = {
        scope: 'global',
        runId: run.report.runId,
        checkId: 'config-boot-config-valid',
        fixId: 'repair'
      } as const
      const fixing = service.fix(request)
      await expect(service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })).resolves.toEqual({
        status: 'busy',
        runId: run.report.runId
      })
      await expect(service.fix(request)).resolves.toEqual({ status: 'stale', reason: 'run_superseded' })
      const replacement = {
        ...run.report,
        ...(change === 'superseded' ? { runId: 'replacement' } : { expiresAt: new Date(0).toISOString() })
      }
      application.get('CacheService').setShared(doctorStateCacheKey('global'), {
        status: 'completed',
        report: replacement
      })
      release(warnWithRepair)
      await expect(fixing).resolves.toMatchObject({
        status: 'stale',
        reason: change === 'superseded' ? 'run_superseded' : 'report_expired'
      })
      expect(state()).toEqual({ status: 'completed', report: replacement })
      expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
    }
  )

  it('passes only a target that the fresh finding offered to its fix handler', async () => {
    const finding = {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'server_errors', params: { count: 1 } },
      actions: [{ kind: 'fix', fixId: 'restart', target: 'server-1' }]
    }
    registryMocks.mcpConnectedRun.mockResolvedValueOnce(finding).mockResolvedValueOnce(finding)
    registryMocks.mcpRestart.mockResolvedValue({ status: 'fixed' })
    const service = createReadyService()
    const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: ['mcp-servers-connected'] })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({
      scope: 'global',
      runId: run.report.runId,
      checkId: 'mcp-servers-connected',
      fixId: 'restart',
      target: 'server-1'
    })

    expect(fixed).toMatchObject({ status: 'fixed', result: { status: 'pass' } })
    expect(registryMocks.mcpRestart).toHaveBeenCalledWith(expect.objectContaining({ target: 'server-1' }))
  })

  it('refuses a targeted fix that the fresh finding did not offer', async () => {
    const finding = {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'server_errors', params: { count: 1 } },
      actions: [{ kind: 'fix', fixId: 'restart', target: 'server-1' }]
    }
    registryMocks.mcpConnectedRun.mockResolvedValue(finding)
    const service = createReadyService()
    const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: ['mcp-servers-connected'] })
    if (run.status !== 'completed') throw new Error('expected a report')

    await expect(
      service.fix({
        scope: 'global',
        runId: run.report.runId,
        checkId: 'mcp-servers-connected',
        fixId: 'restart',
        target: 'server-2'
      })
    ).resolves.toMatchObject({ status: 'stale', reason: 'finding_changed' })
    expect(registryMocks.mcpRestart).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'cancelConnectivity'] as const)(
    'preserves a completed report and its fix after a delayed %s',
    async (cancel) => {
      registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair).mockResolvedValueOnce(warnWithRepair)
      registryMocks.bootConfigRepair.mockResolvedValue({ status: 'requires_relaunch' })
      const service = createReadyService()
      const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
      if (run.status !== 'completed') throw new Error('expected a report')

      expect(service[cancel]('global', run.report.runId)).toEqual({ status: 'not_running' })
      expect(state()).toEqual({ status: 'completed', report: run.report })

      const fixed = await service.fix({
        scope: 'global',
        runId: run.report.runId,
        checkId: 'config-boot-config-valid',
        fixId: 'repair'
      })

      expect(fixed).toMatchObject({
        status: 'requires_relaunch',
        result: { id: 'config-boot-config-valid', status: 'pass' }
      })
      expect(state()).toMatchObject({ status: 'completed', report: { summary: { pass: 2, warn: 0 } } })
    }
  )

  it('preserves pending confirmation and repair after a delayed run cancellation', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair).mockResolvedValueOnce(warnWithRepair)
    registryMocks.bootConfigRepair.mockResolvedValue({ status: 'requires_relaunch' })
    const service = createReadyService()
    const run = await service.run({
      subject: { kind: 'global' },
      tier: 'live',
      checkIds: ['config-boot-config-valid', 'provider-model-conversation']
    })
    if (run.status !== 'completed') throw new Error('expected a report')
    expect(run.report.pendingChecks).toHaveLength(1)

    expect(service.cancel('global', run.report.runId)).toEqual({ status: 'not_running' })
    expect(state()).toEqual({ status: 'completed', report: run.report })
    await expect(
      service.fix({
        scope: 'global',
        runId: run.report.runId,
        checkId: 'config-boot-config-valid',
        fixId: 'repair'
      })
    ).resolves.toMatchObject({ status: 'requires_relaunch', result: { status: 'pass' } })
    await expect(
      service.confirmCheck({
        scope: 'global',
        runId: run.report.runId,
        requestId: run.report.pendingChecks![0].requestId
      })
    ).resolves.toMatchObject({ status: 'completed', pendingChecks: [] })
    expect(state()).toMatchObject({ status: 'completed', report: { summary: { pass: 2, warn: 0 } } })
  })

  it('refuses a fix bound to a superseded run', async () => {
    const service = createReadyService()
    await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    await expect(
      service.fix({ scope: 'global', runId: 'old-run', checkId: 'config-boot-config-valid', fixId: 'repair' })
    ).resolves.toEqual({
      status: 'stale',
      reason: 'run_superseded'
    })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it('refuses a fix while a newer run is in flight', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    const service = createReadyService()
    const first = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    if (first.status !== 'completed') throw new Error('expected a report')

    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const second = service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })

    await expect(
      service.fix({ scope: 'global', runId: first.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    ).resolves.toEqual({ status: 'stale', reason: 'run_superseded' })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()

    release()
    await second
  })

  it('blocks a run while a fix is in flight, so the two never overlap', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    let release!: () => void
    registryMocks.bootConfigRepair.mockReturnValue(
      new Promise((resolve) => (release = () => resolve({ status: 'fixed' })))
    )
    const service = createReadyService()
    const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixing = service.fix({
      scope: 'global',
      runId: run.report.runId,
      checkId: 'config-boot-config-valid',
      fixId: 'repair'
    })
    await vi.waitFor(() => expect(registryMocks.bootConfigRepair).toHaveBeenCalled())
    expect(await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })).toMatchObject({
      status: 'busy'
    })

    release()
    await expect(fixing).resolves.toMatchObject({ status: 'fixed' })
  })

  it('refuses a fix when a fresh probe no longer offers it', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair)
    const service = createReadyService()
    const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({
      scope: 'global',
      runId: run.report.runId,
      checkId: 'config-boot-config-valid',
      fixId: 'repair'
    })
    expect(fixed).toMatchObject({ status: 'stale', reason: 'finding_changed', result: { status: 'pass' } })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it('reports a throwing fix as failed but still returns the fresh probe result', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair).mockResolvedValueOnce(warnWithRepair)
    registryMocks.bootConfigRepair.mockRejectedValue(new Error('disk is read-only'))
    const service = createReadyService()
    const run = await service.run({ subject: { kind: 'global' }, tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({
      scope: 'global',
      runId: run.report.runId,
      checkId: 'config-boot-config-valid',
      fixId: 'repair'
    })
    expect(fixed).toMatchObject({ status: 'failed', message: 'disk is read-only', result: { status: 'pass' } })
  })
})
