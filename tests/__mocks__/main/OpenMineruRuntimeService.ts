import { vi } from 'vitest'

export const MockMainOpenMineruRuntimeServiceExport = {
  openMineruRuntimeService: {
    startTask: vi.fn((_: string, runner: (signal: AbortSignal) => Promise<void>) => {
      const controller = new AbortController()
      void runner(controller.signal)
    })
  }
}
