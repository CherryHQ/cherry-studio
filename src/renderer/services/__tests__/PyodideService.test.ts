import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ workers: [] as Array<{ terminate: ReturnType<typeof vi.fn> }> }))
vi.mock('../../workers/pyodide.worker?worker', () => ({
  default: class {
    terminate = vi.fn()
    addEventListener = vi.fn()
    removeEventListener = vi.fn()
    constructor() {
      state.workers.push(this)
    }
  }
}))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn(), info: vi.fn() }) } }))
vi.mock('@renderer/utils/uuid', () => ({ uuid: () => 'test-call' }))

afterEach(() => {
  vi.useRealTimers()
  state.workers.length = 0
  vi.resetModules()
})

it('terminates a stalled bootstrap and returns repair guidance before trying a new worker', async () => {
  vi.useFakeTimers()
  const { pyodideService } = await import('../PyodideService')
  const first = pyodideService.runScript('print(1)')
  await vi.dynamicImportSettled()
  await vi.advanceTimersByTimeAsync(30_000)
  expect((await first).text).toContain('Repair the application installation')
  expect(state.workers).toHaveLength(1)
  expect(state.workers[0].terminate).toHaveBeenCalledOnce()
  const second = pyodideService.runScript('print(2)')
  await vi.dynamicImportSettled()
  await vi.advanceTimersByTimeAsync(30_000)
  expect((await second).text).toContain('Repair the application installation')
  expect(state.workers).toHaveLength(2)
  expect(state.workers[1].terminate).toHaveBeenCalledOnce()
})
