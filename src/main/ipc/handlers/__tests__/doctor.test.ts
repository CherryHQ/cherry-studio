import { beforeEach, describe, expect, it, vi } from 'vitest'

const doctor = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn(), fix: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ DoctorService: doctor } as never)
})

import { doctorHandlers } from '../doctor'

const ctx = { senderId: 'main' }

beforeEach(() => vi.clearAllMocks())

describe('doctorHandlers', () => {
  it('forwards a run request including the optional check subset', async () => {
    doctor.run.mockResolvedValue({ status: 'busy', runId: 'r1' })
    const input = { tier: 'live' as const, checkIds: ['config-boot-config-valid' as const] }
    await expect(doctorHandlers['diagnostics.doctor.run'](input, ctx)).resolves.toEqual({ status: 'busy', runId: 'r1' })
    expect(doctor.run).toHaveBeenCalledWith(input)
  })

  it('cancels by run id', async () => {
    doctor.cancel.mockReturnValue({ status: 'canceled' })
    await expect(doctorHandlers['diagnostics.doctor.cancel']({ runId: 'r1' }, ctx)).resolves.toEqual({
      status: 'canceled'
    })
    expect(doctor.cancel).toHaveBeenCalledWith('r1')
  })

  it('forwards a fix request untouched', async () => {
    const request = { runId: 'r1', checkId: 'config-boot-config-valid' as const, fixId: 'repair' as const }
    doctor.fix.mockResolvedValue({ status: 'fixed', result: { id: request.checkId, status: 'pass', durationMs: 1 } })
    await expect(doctorHandlers['diagnostics.doctor.fix'](request, ctx)).resolves.toMatchObject({ status: 'fixed' })
    expect(doctor.fix).toHaveBeenCalledWith(request)
  })
})
