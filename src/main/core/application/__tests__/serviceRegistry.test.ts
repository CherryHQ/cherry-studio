import { describe, expect, it } from 'vitest'

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
