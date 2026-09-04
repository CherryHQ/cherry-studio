import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DoctorContext } from '../types'

const registryMocks = vi.hoisted(() => ({
  bootConfigRun: vi.fn(),
  bootConfigRepair: vi.fn(),
  hardwareAccelerationRun: vi.fn(),
  hardwareAccelerationEnable: vi.fn(),
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
        fixes: { enable: registryMocks.hardwareAccelerationEnable }
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
  registryMocks.hardwareAccelerationRun.mockResolvedValue({ status: 'pass' })
  registryMocks.mcpConnectedRun.mockResolvedValue({ status: 'pass' })
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
  it('runs a fix offered as informational guidance on a passing check', async () => {
    registryMocks.hardwareAccelerationRun
      .mockResolvedValueOnce({
        status: 'pass',
        detail: { variant: 'disabled_without_recent_crash' },
        actions: [{ kind: 'fix', fixId: 'enable' }]
      })
      .mockResolvedValueOnce({
        status: 'pass',
        detail: { variant: 'disabled_without_recent_crash' },
        actions: [{ kind: 'fix', fixId: 'enable' }]
      })
    registryMocks.hardwareAccelerationEnable.mockResolvedValue({ status: 'requires_relaunch' })
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: ['config-hardware-acceleration'] })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({
      runId: run.report.runId,
      checkId: 'config-hardware-acceleration',
      fixId: 'enable'
    })

    expect(fixed).toMatchObject({ status: 'requires_relaunch', result: { status: 'pass' } })
    expect(registryMocks.hardwareAccelerationEnable).toHaveBeenCalledOnce()
  })

  it('passes only a target that the fresh finding offered to its fix handler', async () => {
    const finding = {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'server_errors', params: { count: 1 } },
      actions: [{ kind: 'fix', fixId: 'restart', target: 'server-1' }]
    }
    registryMocks.mcpConnectedRun.mockResolvedValueOnce(finding).mockResolvedValueOnce(finding)
    registryMocks.mcpRestart.mockResolvedValue({ status: 'fixed' })
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: ['mcp-servers-connected'] })
    if (run.status !== 'completed') throw new Error('expected a report')

    const fixed = await service.fix({
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
    const service = new DoctorService()
    const run = await service.run({ tier: 'quick', checkIds: ['mcp-servers-connected'] })
    if (run.status !== 'completed') throw new Error('expected a report')

    await expect(
      service.fix({
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
