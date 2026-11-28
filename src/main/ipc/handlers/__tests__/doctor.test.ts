import { beforeEach, describe, expect, it, vi } from 'vitest'

const doctor = vi.hoisted(() => ({ run: vi.fn(), runContextualDiagnosis: vi.fn(), cancel: vi.fn(), fix: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ DoctorService: doctor } as never)
})

import { application } from '@application'

import { doctorHandlers } from '../doctor'

const ctx = { senderId: 'main' }

beforeEach(() => vi.clearAllMocks())

describe('doctorHandlers', () => {
  it('forwards a run request including the optional check subset', async () => {
    doctor.run.mockResolvedValue({ status: 'busy', runId: 'r1' })
    const input = {
      subject: { kind: 'global' as const },
      tier: 'live' as const,
      checkIds: ['config-boot-config-valid' as const]
    }
    await expect(doctorHandlers['diagnostics.doctor.run'](input, ctx)).resolves.toEqual({ status: 'busy', runId: 'r1' })
    expect(doctor.run).toHaveBeenCalledWith(input)
  })

  it('cancels by run id', async () => {
    doctor.cancel.mockReturnValue({ status: 'canceled' })
    await expect(doctorHandlers['diagnostics.doctor.cancel']({ scope: 'global', runId: 'r1' }, ctx)).resolves.toEqual({
      status: 'canceled'
    })
    expect(doctor.cancel).toHaveBeenCalledWith('global', 'r1')
  })

  it('delegates contextual diagnosis to its dedicated service entrypoint', async () => {
    doctor.runContextualDiagnosis.mockResolvedValue({ status: 'busy', runId: 'r-context' })
    const subject = { kind: 'agent' as const, agentId: 'agent-1' }
    await expect(doctorHandlers['diagnostics.doctor.run_contextual']({ subject }, ctx)).resolves.toEqual({
      status: 'busy',
      runId: 'r-context'
    })
    expect(doctor.runContextualDiagnosis).toHaveBeenCalledWith(subject)
    expect(doctor.run).not.toHaveBeenCalled()
  })

  it('forwards a fix request untouched', async () => {
    const request = {
      scope: 'global' as const,
      runId: 'r1',
      checkId: 'config-boot-config-valid' as const,
      fixId: 'repair' as const
    }
    doctor.fix.mockResolvedValue({ status: 'fixed', result: { id: request.checkId, status: 'pass', durationMs: 1 } })
    await expect(doctorHandlers['diagnostics.doctor.fix'](request, ctx)).resolves.toMatchObject({ status: 'fixed' })
    expect(doctor.fix).toHaveBeenCalledWith(request)
  })

  describe('analytics', () => {
    const reported = () =>
      vi.mocked(application.get('AnalyticsService').trackProductEvent).mock.calls.map(([event]) => event)
    const input = { subject: { kind: 'global' as const }, tier: 'quick' as const }

    it('reports a finished run with fail and warn counts only, and nothing for a busy scope', async () => {
      doctor.run.mockResolvedValueOnce({
        status: 'completed',
        report: { summary: { pass: 9, warn: 2, fail: 1, skip: 0, unknown: 0 }, results: [{ id: 'secret' }] }
      })
      doctor.run.mockResolvedValueOnce({ status: 'busy', runId: 'r1' })
      doctor.run.mockResolvedValueOnce({ status: 'canceled', runId: 'r2' })
      doctor.run.mockRejectedValueOnce(new Error('Doctor is not ready'))

      await doctorHandlers['diagnostics.doctor.run'](input, ctx)
      await doctorHandlers['diagnostics.doctor.run'](input, ctx)
      await doctorHandlers['diagnostics.doctor.run'](input, ctx)
      await expect(doctorHandlers['diagnostics.doctor.run'](input, ctx)).rejects.toThrow('not ready')

      expect(reported()).toEqual([
        { event: 'diagnostics_run', tier: 'quick', status: 'completed', failCount: 1, warnCount: 2, origin: 'ui' },
        { event: 'diagnostics_run', tier: 'quick', status: 'canceled', origin: 'ui' },
        { event: 'diagnostics_run', tier: 'quick', status: 'failed', origin: 'ui' }
      ])
    })

    it('reports a fix by its static check and fix ids with the outcome', async () => {
      const request = {
        scope: 'global' as const,
        runId: 'r1',
        checkId: 'config-boot-config-valid' as const,
        fixId: 'repair' as const
      }
      doctor.fix.mockResolvedValueOnce({ status: 'stale', reason: 'run_superseded' })

      await doctorHandlers['diagnostics.doctor.fix'](request, ctx)

      expect(reported()).toEqual([
        { event: 'diagnostics_fix', check: 'config-boot-config-valid', fix: 'repair', result: 'stale', origin: 'ui' }
      ])
    })
  })
})
