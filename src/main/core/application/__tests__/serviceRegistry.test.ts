import { describe, expect, it, vi } from 'vitest'

// Registry assembly does not run native Electron integrations, which cannot load under the Node test runner.
vi.mock('@sentry/electron/main', () => ({
  addIntegration: vi.fn(),
  sentryMinidumpIntegration: vi.fn()
}))

vi.mock('@electron-toolkit/utils', () => ({ optimizer: { watchWindowShortcuts: vi.fn() } }))

import { serviceList, services } from '../serviceRegistry'

describe('production service registrations', () => {
  it('preserves class identity and declaration order when factories replace parameterized registrations', () => {
    const registeredClasses = serviceList.map((registration) =>
      typeof registration === 'function' ? registration : registration.target
    )

    expect(registeredClasses).toEqual(Object.values(services))

    const factories = serviceList.filter((registration) => typeof registration !== 'function')
    expect(factories).toHaveLength(2)
    expect(factories.map((registration) => registration.target)).toEqual(
      expect.arrayContaining([services.AiStreamManager, services.UtilityProcessManager])
    )
    expect(typeof services.AiStreamManager).toBe('function')
    expect(typeof services.UtilityProcessManager).toBe('function')
  })
})
