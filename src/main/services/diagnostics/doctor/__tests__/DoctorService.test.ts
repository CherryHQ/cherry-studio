import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registryMocks = vi.hoisted(() => ({
  bootConfigRun: vi.fn(),
  bootConfigRepair: vi.fn(),
  userDataRun: vi.fn()
}))

vi.mock('../registry', () => ({
  doctorCheckRegistry: {
    'config-boot-config-valid': {
      id: 'config-boot-config-valid',
      run: registryMocks.bootConfigRun,
      fixes: { repair: registryMocks.bootConfigRepair }
    },
    'storage-userdata-writable': { id: 'storage-userdata-writable', run: registryMocks.userDataRun, fixes: {} }
  }
}))
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

const { DoctorService } = await import('../DoctorService')

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
})

describe('DoctorService.run', () => {
  it('publishes running progress and then the completed report on the shared cache', async () => {
    const service = new DoctorService()
    const outcome = await service.run({ tier: 'quick' })

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

  it('answers busy with the in-flight run id, and that id can cancel the run', async () => {
    let release!: () => void
    registryMocks.userDataRun.mockReturnValue(new Promise((resolve) => (release = () => resolve({ status: 'pass' }))))
    const service = new DoctorService()

    const first = service.run({ tier: 'quick' })
    const busy = await service.run({ tier: 'quick' })
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
    const run = await service.run({ tier: 'quick' })
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
    await service.run({ tier: 'quick' })
    await expect(
      service.fix({ runId: 'old-run', checkId: 'config-boot-config-valid', fixId: 'repair' })
    ).resolves.toEqual({
      status: 'stale',
      reason: 'run_superseded'
    })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it('refuses a fix when a fresh probe no longer offers it', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair)
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick' })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({ runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    expect(fixed).toMatchObject({ status: 'stale', reason: 'finding_changed', result: { status: 'pass' } })
    expect(registryMocks.bootConfigRepair).not.toHaveBeenCalled()
  })

  it('reports a throwing fix as failed but still returns the fresh probe result', async () => {
    registryMocks.bootConfigRun.mockResolvedValueOnce(warnWithRepair).mockResolvedValueOnce(warnWithRepair)
    registryMocks.bootConfigRepair.mockRejectedValue(new Error('disk is read-only'))
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick' })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({ runId: run.report.runId, checkId: 'config-boot-config-valid', fixId: 'repair' })
    expect(fixed).toMatchObject({ status: 'failed', message: 'disk is read-only', result: { status: 'pass' } })
  })
})
