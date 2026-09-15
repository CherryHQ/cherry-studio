import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DoctorContext } from '../types'

const registryMocks = vi.hoisted(() => ({
  bootConfigRun: vi.fn(),
  bootConfigRepair: vi.fn(),
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
      'network-online': { id: 'network-online', run: sharing, fixes: {} },
      'network-dns-resolution': { id: 'network-dns-resolution', run: sharing, fixes: {} }
    }
  }
})
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

const { DoctorService } = await import('../DoctorService')

// The registry mock implements only a few checks; the catalog lists more.
const MOCKED = ['config-boot-config-valid', 'storage-userdata-location'] as const

const state = () => application.get('CacheService').getShared('doctor.state')
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
  registryMocks.userDataRun.mockResolvedValue({ status: 'pass' })
  registryMocks.sharedProbe.mockResolvedValue([])
})

describe('DoctorContext.share', () => {
  const SHARING = ['network-online', 'network-dns-resolution'] as const

  it('runs a shared probe once per run even for checks in different layers', async () => {
    const service = new DoctorService()
    const outcome = await service.run({ tier: 'live', checkIds: SHARING })
    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.summary).toMatchObject({ pass: 2 })
    expect(registryMocks.sharedProbe).toHaveBeenCalledTimes(1)
  })

  it('probes afresh for every new run', async () => {
    const service = new DoctorService()
    await service.run({ tier: 'live', checkIds: SHARING })
    await service.run({ tier: 'live', checkIds: SHARING })
    expect(registryMocks.sharedProbe).toHaveBeenCalledTimes(2)
  })
})

describe('DoctorService.run', () => {
  it('publishes running progress and then the completed report on the shared cache', async () => {
    const service = new DoctorService()
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
    expect(published.map((value) => (value as { status: string }).status)).toEqual([
      'running',
      'running',
      'running',
      'completed'
    ])
  })

  it('pulls in the prerequisites of a partial selection instead of rejecting', async () => {
    const service = new DoctorService()
    const outcome = await service.run({ tier: 'live', checkIds: ['network-dns-resolution'] })

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.results.map((result) => result.id)).toEqual(['network-dns-resolution', 'network-online'])
  })

  it('counts a repeated check once', async () => {
    const service = new DoctorService()
    const outcome = await service.run({
      tier: 'quick',
      checkIds: ['config-boot-config-valid', 'config-boot-config-valid']
    })

    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') return
    expect(outcome.report.results).toHaveLength(1)
    expect(outcome.report.summary).toMatchObject({ pass: 1 })
  })

  it('leaves a terminal state behind when the run throws after publishing running', async () => {
    const service = new DoctorService()
    // The catalog declares this check; the registry mock does not implement it.
    await expect(service.run({ tier: 'live', checkIds: ['network-tls-handshake'] })).rejects.toThrow()
    expect(state()).toEqual({ status: 'idle' })
  })

  it('aborts an in-flight run when the service stops', async () => {
    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const service = new DoctorService()

    const run = service.run({ tier: 'quick', checkIds: MOCKED })
    ;(service as unknown as { onStop(): void }).onStop()
    release()

    await expect(run).resolves.toMatchObject({ status: 'canceled' })
  })

  it('answers busy with the in-flight run id, and that id can cancel the run', async () => {
    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const service = new DoctorService()

    const first = service.run({ tier: 'quick', checkIds: MOCKED })
    const busy = await service.run({ tier: 'quick', checkIds: MOCKED })
    expect(busy.status).toBe('busy')
    if (busy.status !== 'busy') return
    expect(service.cancel('someone-else')).toEqual({ status: 'not_running' })
    expect(service.cancel(busy.runId)).toEqual({ status: 'canceled' })
    release()
    await expect(first).resolves.toEqual({ status: 'canceled', runId: busy.runId })
    expect(state()).toEqual({ status: 'canceled', runId: busy.runId })
  })
})

describe('DoctorService.fix', () => {
  it('re-validates the finding, runs the fix, re-probes and patches the report', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair).mockResolvedValueOnce(warnWithRepair)
    registryMocks.bootConfigRepair.mockResolvedValue({ status: 'requires_relaunch' })
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({ runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })

    expect(fixed).toMatchObject({
      status: 'requires_relaunch',
      result: { id: 'config-boot-config-valid', status: 'pass' }
    })
    expect(state()).toMatchObject({ status: 'completed', report: { summary: { pass: 2, warn: 0 } } })
  })

  it('refuses a fix bound to a superseded run', async () => {
    const service = new DoctorService()
    await service.run({ tier: 'quick', checkIds: MOCKED })
    await expect(
      service.fix({ runId: 'old-run', checkId: 'config-boot-config-valid', fixId: 'repair' })
    ).resolves.toEqual({
      status: 'stale',
      reason: 'run_superseded'
    })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it('refuses a fix bound to an expired report', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')
    const expired = { ...run.report, expiresAt: new Date(Date.now() - 1).toISOString() }
    application.get('CacheService').setShared('doctor.state', { status: 'completed', report: expired })

    await expect(
      service.fix({ runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    ).resolves.toEqual({ status: 'stale', reason: 'run_superseded' })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it('refuses a fix while a newer run is in flight', async () => {
    registryMocks.bootConfigRun.mockResolvedValue(warnWithRepair)
    const service = new DoctorService()
    const first = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (first.status !== 'completed') throw new Error('expected a report')

    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const second = service.run({ tier: 'quick', checkIds: MOCKED })

    await expect(
      service.fix({ runId: first.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
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
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixing = service.fix({ runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    await vi.waitFor(() => expect(registryMocks.bootConfigRepair).toHaveBeenCalled())
    expect(await service.run({ tier: 'quick', checkIds: MOCKED })).toMatchObject({ status: 'busy' })

    release()
    await expect(fixing).resolves.toMatchObject({ status: 'fixed' })
  })

  it('refuses a fix when a fresh probe no longer offers it', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair)
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({ runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    expect(fixed).toMatchObject({ status: 'stale', reason: 'finding_changed', result: { status: 'pass' } })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it('reports a throwing fix as failed but still returns the fresh probe result', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair).mockResolvedValueOnce(warnWithRepair)
    registryMocks.bootConfigRepair.mockRejectedValue(new Error('disk is read-only'))
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: MOCKED })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({ runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    expect(fixed).toMatchObject({ status: 'failed', message: 'disk is read-only', result: { status: 'pass' } })
  })
})
