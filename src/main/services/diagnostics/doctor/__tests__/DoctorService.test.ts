import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type { DoctorScopeKey, DoctorState } from '@shared/types/doctor'

import type { DoctorContext } from '../types'

const registryMocks = vi.hoisted(() => ({
  bootConfigRun: vi.fn(),
  bootConfigRepair: vi.fn(),
  hardwareAccelerationRun: vi.fn(),
  mcpConnectedRun: vi.fn(),
  mcpRestart: vi.fn(),
  userDataRun: vi.fn(),
  sharedProbe: vi.fn()
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
      'network-online': { id: 'network-online', run: sharing, fixes: {} },
      'network-dns-resolution': { id: 'network-dns-resolution', run: sharing, fixes: {} }
    }
  }
})
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))
const assistants = vi.hoisted(() => ({ getById: vi.fn() }))
vi.mock('@main/data/services/AssistantService', () => ({ assistantDataService: assistants }))

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

const stateOf = (scope: DoctorScopeKey) => application.get('CacheService').getShared(`doctor.state.${scope}`)
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
})

describe('DoctorContext.share', () => {
  const SHARING = ['network-online', 'network-dns-resolution'] as const

  it('runs a shared probe once per run even for checks in different layers', async () => {
    const service = createReadyService()
    const outcome = await service.run({ tier: 'live', checkIds: SHARING })
    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.summary).toMatchObject({ pass: 2 })
    expect(registryMocks.sharedProbe).toHaveBeenCalledTimes(1)
  })

  it('probes afresh for every new run', async () => {
    const service = createReadyService()
    await service.run({ tier: 'live', checkIds: SHARING })
    await service.run({ tier: 'live', checkIds: SHARING })
    expect(registryMocks.sharedProbe).toHaveBeenCalledTimes(2)
  })
})

describe('DoctorService.run', () => {
  it('rejects early calls without publishing a running state', async () => {
    await expect(new DoctorService().run({ tier: 'quick', checkIds: MOCKED })).rejects.toThrow('not ready')
    expect(state()?.status).not.toBe('running')
  })

  it('includes transitive dependencies for selected checks', async () => {
    const result = await createReadyService().run({ tier: 'live', checkIds: ['network-dns-resolution'] })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.report.results.map((item) => item.id)).toEqual(['network-dns-resolution', 'network-online'])
  })

  it('rejects a tier mismatch before publishing running', async () => {
    await expect(createReadyService().run({ tier: 'quick', checkIds: ['network-dns-resolution'] })).rejects.toThrow(
      'tier'
    )
    expect(state()?.status).not.toBe('running')
  })

  it('ends running when collection of the report fails', async () => {
    const service = createReadyService()
    vi.spyOn(service as unknown as { collectBasics(): Promise<never> }, 'collectBasics').mockRejectedValueOnce(
      new Error('read failed')
    )
    await expect(service.run({ tier: 'quick', checkIds: MOCKED })).rejects.toThrow('read failed')
    expect(state()).toEqual({ status: 'idle' })
    expect((await service.run({ tier: 'quick', checkIds: MOCKED })).status).toBe('completed')
  })

  it('publishes running progress and then the completed report on the shared cache', async () => {
    const service = createReadyService()
    const outcome = await service.run({ tier: 'quick', checkIds: MOCKED })

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.summary).toEqual({ pass: 2, warn: 0, fail: 0, skip: 0, error: 0 })
    expect(outcome.report.basics).toMatchObject({
      edition: 'global',
      channel: 'latest',
      userDataPath: '/mock/app.userdata'
    })
    expect(new Date(outcome.report.expiresAt).getTime()).toBeGreaterThan(new Date(outcome.report.finishedAt).getTime())
    expect(state()).toEqual({ status: 'completed', report: outcome.report })

    const published = vi.mocked(application.get('CacheService').setShared).mock.calls.map(([, value]) => value)
    const runningUpdates = published.filter(
      (value): value is Extract<DoctorState, { status: 'running' }> =>
        typeof value === 'object' && value !== null && 'status' in value && value.status === 'running'
    )
    expect(
      runningUpdates.map(({ activeCheckIds, results }) => ({
        activeCheckIds,
        resultIds: results.map((result) => result.id)
      }))
    ).toEqual([
      { activeCheckIds: [], resultIds: [] },
      { activeCheckIds: ['config-boot-config-valid'], resultIds: [] },
      { activeCheckIds: ['config-boot-config-valid', 'storage-userdata-location'], resultIds: [] },
      { activeCheckIds: ['storage-userdata-location'], resultIds: ['config-boot-config-valid'] },
      {
        activeCheckIds: [],
        resultIds: ['config-boot-config-valid', 'storage-userdata-location']
      }
    ])
    expect(published.at(-1)).toEqual({ status: 'completed', report: outcome.report })
  })

  it('counts a repeated check once', async () => {
    const service = createReadyService()
    const outcome = await service.run({
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

    const run = service.run({ tier: 'quick', checkIds: MOCKED })
    ;(service as unknown as { onStop(): void }).onStop()
    release()

    await expect(run).resolves.toMatchObject({ status: 'canceled' })
  })

  it('answers busy with the in-flight run id, and that id can cancel the run', async () => {
    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const service = createReadyService()

    const first = service.run({ tier: 'quick', checkIds: MOCKED })
    const busy = await service.run({ tier: 'quick', checkIds: MOCKED })
    expect(busy.status).toBe('busy')
    if (busy.status !== 'busy') return
    expect(service.cancel('global', 'someone-else')).toEqual({ status: 'not_running' })
    expect(service.cancel('global', busy.runId)).toEqual({ status: 'canceled' })
    release()
    await expect(first).resolves.toEqual({ status: 'canceled', runId: busy.runId })
    expect(state()).toEqual({ status: 'canceled', runId: busy.runId })
  })
})

describe('DoctorService scopes', () => {
  const chat = { kind: 'chat', providerId: 'openai', modelId: 'gpt-4o' } as const

  it('keeps a contextual run in its own scope, leaving the global report untouched', async () => {
    const service = createReadyService()
    const global = await service.run({ tier: 'quick', checkIds: MOCKED })
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

    const global = service.run({ tier: 'quick', checkIds: MOCKED })
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

  it('hands a parameterised check the facts an agent subject resolves to', async () => {
    assistants.getById.mockReturnValue({ modelId: 'openai::gpt-4o', mcpServerIds: ['srv-1'] })
    const service = createReadyService()
    await service.run({ tier: 'quick', subject: { kind: 'agent', agentId: 'a1' }, checkIds: ['mcp-servers-connected'] })

    expect(assistants.getById).toHaveBeenCalledWith('a1')
    expect(registryMocks.mcpConnectedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { agentId: 'a1', providerId: 'openai', modelId: 'gpt-4o', mcpServerIds: ['srv-1'] }
      })
    )
  })

  it('gives a global run no subject, so parameterised checks fall back to defaults', async () => {
    const service = createReadyService()
    await service.run({ tier: 'quick', checkIds: ['mcp-servers-connected'] })
    expect(registryMocks.mcpConnectedRun).toHaveBeenCalledWith(expect.objectContaining({ subject: null }))
  })

  it('refuses a fix addressed to a scope other than the report it names', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    const service = createReadyService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
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
  it('rejects expired reports without performing a fix', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    const service = createReadyService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected report')
    application.get('CacheService').setShared('doctor.state.global', {
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
      const run = await service.run({ tier: 'quick', checkIds: MOCKED })
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
      await expect(service.run({ tier: 'quick', checkIds: MOCKED })).resolves.toEqual({
        status: 'busy',
        runId: run.report.runId
      })
      await expect(service.fix(request)).resolves.toEqual({ status: 'stale', reason: 'run_superseded' })
      const replacement = {
        ...run.report,
        ...(change === 'superseded' ? { runId: 'replacement' } : { expiresAt: new Date(0).toISOString() })
      }
      application.get('CacheService').setShared('doctor.state.global', { status: 'completed', report: replacement })
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
    const run = await service.run({ tier: 'quick', checkIds: ['mcp-servers-connected'] })
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
    const run = await service.run({ tier: 'quick', checkIds: ['mcp-servers-connected'] })
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

  it('re-validates the finding, runs the fix, re-probes and patches the report', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair).mockResolvedValueOnce(warnWithRepair)
    registryMocks.bootConfigRepair.mockResolvedValue({ status: 'requires_relaunch' })
    const service = createReadyService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

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
  })

  it('refuses a fix bound to a superseded run', async () => {
    const service = createReadyService()
    await service.run({ tier: 'quick', checkIds: MOCKED })
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
    const first = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (first.status !== 'completed') throw new Error('expected a report')

    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const second = service.run({ tier: 'quick', checkIds: MOCKED })

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
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixing = service.fix({
      scope: 'global',
      runId: run.report.runId,
      checkId: 'config-boot-config-valid',
      fixId: 'repair'
    })
    await vi.waitFor(() => expect(registryMocks.bootConfigRepair).toHaveBeenCalled())
    expect(await service.run({ tier: 'quick', checkIds: MOCKED })).toMatchObject({ status: 'busy' })

    release()
    await expect(fixing).resolves.toMatchObject({ status: 'fixed' })
  })

  it('refuses a fix when a fresh probe no longer offers it', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair)
    const service = createReadyService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
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
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
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
