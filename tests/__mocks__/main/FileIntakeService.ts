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
  'drain',
  'onChanged'
] as const
export const mockFileIntakeService = Object.fromEntries(methods.map((name) => [name, vi.fn()])) as {
  [K in (typeof methods)[number]]: ReturnType<typeof vi.fn>
}
mockFileIntakeService.owners.mockResolvedValue([])
mockFileIntakeService.onChanged.mockReturnValue({ dispose: () => {} })

export const MockFileIntakeUtils = {
  setImplementation(service: Record<(typeof methods)[number], (...args: any[]) => any>) {
    for (const name of methods) mockFileIntakeService[name].mockImplementation(service[name].bind(service))
  }
}
