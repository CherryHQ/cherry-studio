import { describe, expect, it, vi } from 'vitest'

const dashboard = {
  getStatus: vi.fn(),
  start: vi.fn(),
  stop: vi.fn()
}

vi.mock('@application', () => ({
  application: { get: vi.fn(() => dashboard) }
}))

const { hermesDashboardHandlers } = await import('../hermesDashboard')

const ctx = { senderId: 'w1' }

describe('hermesDashboardHandlers', () => {
  it('delegates lifecycle commands to the Dashboard service', async () => {
    dashboard.start.mockResolvedValue({ success: true, url: 'http://127.0.0.1:49152' })
    dashboard.stop.mockResolvedValue(undefined)
    dashboard.getStatus.mockReturnValue({ status: 'running', url: 'http://127.0.0.1:49152' })

    await expect(hermesDashboardHandlers['hermes_dashboard.start'](undefined, ctx)).resolves.toEqual({
      success: true,
      url: 'http://127.0.0.1:49152'
    })
    await expect(hermesDashboardHandlers['hermes_dashboard.stop'](undefined, ctx)).resolves.toEqual({ success: true })
    await expect(hermesDashboardHandlers['hermes_dashboard.get_status'](undefined, ctx)).resolves.toEqual({
      status: 'running',
      url: 'http://127.0.0.1:49152'
    })
  })

  it('returns an operation failure when Dashboard startup throws', async () => {
    dashboard.start.mockRejectedValue(new Error('Dashboard dependencies are missing'))

    await expect(hermesDashboardHandlers['hermes_dashboard.start'](undefined, ctx)).resolves.toEqual({
      success: false,
      message: 'Dashboard dependencies are missing'
    })
  })
})
