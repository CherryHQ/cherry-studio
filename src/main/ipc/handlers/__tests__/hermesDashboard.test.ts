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

  it('reports a thrown stop failure as an operation result without leaking the secret in its message', async () => {
    dashboard.stop.mockRejectedValue(new Error('taskkill failed: CHERRY_HERMES_API_KEY=sk-real-secret'))

    const result = await hermesDashboardHandlers['hermes_dashboard.stop'](undefined, ctx)

    expect(result).toEqual({ success: false, message: expect.stringContaining('taskkill failed') })
    expect(result).not.toMatchObject({ message: expect.stringContaining('sk-real-secret') })
  })

  it('returns an operation failure when Dashboard startup throws', async () => {
    dashboard.start.mockRejectedValue(new Error('Dashboard dependencies are missing'))

    await expect(hermesDashboardHandlers['hermes_dashboard.start'](undefined, ctx)).resolves.toEqual({
      success: false,
      reason: 'startup_failed',
      message: 'Dashboard dependencies are missing'
    })
  })

  it('forwards an in-band start failure result unchanged, preserving its specific reason', async () => {
    // The catch path coerces reason to 'startup_failed'; an in-band failure Result
    // must reach the caller with the service's own reason, not be overwritten.
    dashboard.start.mockResolvedValue({
      success: false,
      reason: 'dashboard_dependencies_missing',
      message: 'Hermes Dashboard dependencies are missing'
    })

    await expect(hermesDashboardHandlers['hermes_dashboard.start'](undefined, ctx)).resolves.toEqual({
      success: false,
      reason: 'dashboard_dependencies_missing',
      message: 'Hermes Dashboard dependencies are missing'
    })
  })
})
