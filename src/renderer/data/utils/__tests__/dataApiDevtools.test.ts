import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/config/constant', () => ({
  isDev: true
}))

describe('DataApiDevtools', () => {
  afterEach(async () => {
    const { dataApiDevtoolsTesting } = await import('../dataApiDevtools')
    dataApiDevtoolsTesting.reset()
  })

  it('truncates deep, wide, and long payload previews', async () => {
    const { dataApiDevtoolsTesting } = await import('../dataApiDevtools')

    const deepValue = { level1: { level2: { level3: { level4: { level5: { level6: 'hidden' } } } } } }
    expect(JSON.stringify(dataApiDevtoolsTesting.sanitizeValue(deepValue))).toContain('<max-depth>')

    const longArray = Array.from({ length: 55 }, (_, index) => index)
    expect(dataApiDevtoolsTesting.sanitizeValue(longArray)).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      '<truncated 5 items>'
    ])

    const wideObject = Object.fromEntries(Array.from({ length: 105 }, (_, index) => [`key${index}`, index]))
    const sanitizedObject = dataApiDevtoolsTesting.sanitizeValue(wideObject) as Record<string, unknown>
    expect(sanitizedObject.key0).toBe(0)
    expect(sanitizedObject.key99).toBe(99)
    expect(sanitizedObject.key100).toBeUndefined()
    expect(sanitizedObject.__truncatedKeys).toBe(5)
  })

  it('strips request and response payloads when capture is disabled', async () => {
    const { DataApiDevtools } = await import('../dataApiDevtools')

    DataApiDevtools.recordStart({
      requestId: 'setup',
      method: 'GET',
      path: '/setup',
      retryAttempt: 0
    })
    window.__CHERRY_DATA_API_DEVTOOLS__?.clear()
    window.__CHERRY_DATA_API_DEVTOOLS__?.setOptions({ capturePayloads: false })

    DataApiDevtools.recordStart({
      requestId: 'req_1',
      method: 'POST',
      path: '/providers',
      query: { search: 'openai' },
      body: { token: 'visible-in-devtools' },
      retryAttempt: 0
    })
    DataApiDevtools.recordSuccess({
      requestId: 'req_1',
      method: 'POST',
      path: '/providers',
      response: {
        id: 'req_1',
        status: 200,
        data: { token: 'response-token' },
        metadata: { timestamp: Date.now() }
      }
    })

    const events = window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot() ?? []
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      state: 'success',
      method: 'POST',
      path: '/providers',
      status: 200
    })
    expect(events[0].query).toBeUndefined()
    expect(events[0].body).toBeUndefined()
    expect(events[0].response).toBeUndefined()
  })

  it('does not throw when payload accessors throw', async () => {
    const { DataApiDevtools } = await import('../dataApiDevtools')
    const throwingPayload = {
      get value() {
        throw new Error('payload getter failed')
      }
    }
    const throwingError = {
      name: 'DataApiError',
      get message() {
        throw new Error('error getter failed')
      }
    }

    expect(() =>
      DataApiDevtools.recordStart({
        requestId: 'req_start',
        method: 'POST',
        path: '/providers',
        body: throwingPayload,
        retryAttempt: 0
      })
    ).not.toThrow()
    expect(() =>
      DataApiDevtools.recordSuccess({
        requestId: 'req_success',
        method: 'POST',
        path: '/providers',
        response: {
          id: 'req_success',
          status: 200,
          data: throwingPayload,
          metadata: { timestamp: Date.now() }
        }
      })
    ).not.toThrow()
    expect(() =>
      DataApiDevtools.recordError({
        requestId: 'req_error',
        method: 'POST',
        path: '/providers',
        error: throwingError
      })
    ).not.toThrow()
    expect(() =>
      DataApiDevtools.recordRetry({
        requestId: 'req_retry',
        method: 'POST',
        path: '/providers',
        retryAttempt: 1,
        error: throwingError
      })
    ).not.toThrow()
  })
})
