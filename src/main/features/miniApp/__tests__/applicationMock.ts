import { mockApplicationFactory } from '@test-mocks/main/application'
import { vi } from 'vitest'

/**
 * `vi.mock('@application', () => mockMiniAppApplication({ MiniAppRuntimeService: … }))`.
 *
 * Infrastructure services keep coming from the unified factory (so `getPath`,
 * `getContainer` and the DbService mock all behave), and anything named here wins.
 * Unknown names still throw from the factory's container — a typo stays a failure.
 */
export function mockMiniAppApplication(extra: Record<string, unknown>) {
  const mod = mockApplicationFactory()
  const infra = mod.application.get
  mod.application.get = vi.fn((name: string) => (name in extra ? extra[name] : infra(name)))
  return mod
}
