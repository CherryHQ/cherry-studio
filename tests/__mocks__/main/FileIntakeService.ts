import { vi } from 'vitest'

const methods = [
  'prepare',
  'get',
  'resume',
  'write',
  'complete',
  'cancel',
  'cancelOwner',
  'withEntries',
  'owners',
  'drain'
] as const
export const mockFileIntakeService = Object.fromEntries(methods.map((name) => [name, vi.fn()])) as {
  [K in (typeof methods)[number]]: ReturnType<typeof vi.fn>
}
mockFileIntakeService.owners.mockResolvedValue([])

export const MockFileIntakeUtils = {
  setImplementation(service: Record<(typeof methods)[number], (...args: any[]) => any>) {
    for (const name of methods) mockFileIntakeService[name].mockImplementation(service[name].bind(service))
  }
}
