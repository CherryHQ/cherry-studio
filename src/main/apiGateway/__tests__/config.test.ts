import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockDispatch = vi.fn()

vi.mock('../../services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('../../services/ReduxService', () => ({
  reduxService: {
    select: mockSelect,
    dispatch: mockDispatch
  }
}))

describe('api gateway config cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-21T00:00:00.000Z'))
  })

  it('reuses cached config within ttl window', async () => {
    mockSelect.mockResolvedValue({
      apiGateway: {
        enabled: true,
        port: 8080,
        host: '127.0.0.1',
        apiKey: 'cached-key',
        modelGroups: [],
        enabledEndpoints: ['/v1/messages'],
        exposeToNetwork: false
      }
    })

    const { config } = await import('../config')

    const first = await config.get()
    const second = await config.get()

    expect(first).toEqual(second)
    expect(mockSelect).toHaveBeenCalledTimes(1)
  })

  it('reloads config after ttl expires', async () => {
    mockSelect
      .mockResolvedValueOnce({
        apiGateway: {
          enabled: true,
          port: 8080,
          host: '127.0.0.1',
          apiKey: 'first-key',
          modelGroups: [],
          enabledEndpoints: ['/v1/messages'],
          exposeToNetwork: false
        }
      })
      .mockResolvedValueOnce({
        apiGateway: {
          enabled: true,
          port: 8081,
          host: '127.0.0.1',
          apiKey: 'second-key',
          modelGroups: [],
          enabledEndpoints: ['/v1/messages'],
          exposeToNetwork: true
        }
      })

    const { config } = await import('../config')

    const first = await config.get()
    vi.advanceTimersByTime(5001)
    const second = await config.get()

    expect(first.apiKey).toBe('first-key')
    expect(second.apiKey).toBe('second-key')
    expect(second.port).toBe(8081)
    expect(mockSelect).toHaveBeenCalledTimes(2)
  })

  it('forces refresh when reload is called within ttl window', async () => {
    mockSelect
      .mockResolvedValueOnce({
        apiGateway: {
          enabled: true,
          port: 8080,
          host: '127.0.0.1',
          apiKey: 'first-key',
          modelGroups: [],
          enabledEndpoints: ['/v1/messages'],
          exposeToNetwork: false
        }
      })
      .mockResolvedValueOnce({
        apiGateway: {
          enabled: true,
          port: 9090,
          host: '0.0.0.0',
          apiKey: 'reloaded-key',
          modelGroups: [],
          enabledEndpoints: ['/v1/messages'],
          exposeToNetwork: true
        }
      })

    const { config } = await import('../config')

    const first = await config.get()
    const second = await config.reload()

    expect(first.apiKey).toBe('first-key')
    expect(second.apiKey).toBe('reloaded-key')
    expect(second.port).toBe(9090)
    expect(mockSelect).toHaveBeenCalledTimes(2)
  })
})
