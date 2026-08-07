import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/utils/platform', () => ({
  isDev: true
}))

describe('DataApiDevtools', () => {
  afterEach(async () => {
    const { dataApiDevtoolsTesting } = await import('../dataApiDevtools')
    dataApiDevtoolsTesting.reset()
  })

  it('truncates deep, wide, and long payload previews', async () => {
    const { DataApiDevtools, dataApiDevtoolsTesting } = await import('../dataApiDevtools')
    DataApiDevtools.exposeControlSurface()
    window.__CHERRY_DATA_API_DEVTOOLS__?.setOptions({ capturePayloads: true })

    const deepValue = { level1: { level2: { level3: { level4: { level5: { level6: 'hidden' } } } } } }
    expect(JSON.stringify(dataApiDevtoolsTesting.sanitizeValue(deepValue))).toContain('<max-depth>')

    const longArray = Array.from({ length: 55 }, (_, index) => index)
    expect(dataApiDevtoolsTesting.sanitizeValue(longArray)).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      '<truncated 5 items>'
    ])

    const longString = 'a'.repeat(1005)
    expect(dataApiDevtoolsTesting.sanitizeValue(longString)).toBe(`${'a'.repeat(1000)}...<truncated 5 chars>`)

    const wideObject = Object.fromEntries(Array.from({ length: 105 }, (_, index) => [`key${index}`, index]))
    const sanitizedObject = dataApiDevtoolsTesting.sanitizeValue(wideObject) as Record<string, unknown>
    expect(sanitizedObject.key0).toBe(0)
    expect(sanitizedObject.key99).toBe(99)
    expect(sanitizedObject.key100).toBeUndefined()
    expect(sanitizedObject.__truncatedKeys).toBe(5)
  })

  it('keeps payloads out of polling summaries and exposes them only by request id', async () => {
    const { DataApiDevtools } = await import('../dataApiDevtools')
    DataApiDevtools.exposeControlSurface()
    window.__CHERRY_DATA_API_DEVTOOLS__?.setOptions({ capturePayloads: true })

    DataApiDevtools.recordStart({
      requestId: 'req_summary',
      method: 'POST',
      path: '/providers',
      body: { token: 'request-token' },
      retryAttempt: 0
    })
    DataApiDevtools.recordSuccess({
      requestId: 'req_summary',
      method: 'POST',
      path: '/providers',
      response: { id: 'req_summary', status: 200, data: { token: 'response-token' } }
    })

    const summaries = window.__CHERRY_DATA_API_DEVTOOLS__?.snapshotSummary() ?? []
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ requestId: 'req_summary', state: 'success', status: 200 })
    expect(summaries[0].body).toBeUndefined()
    expect(summaries[0].response).toBeUndefined()
    expect(window.__CHERRY_DATA_API_DEVTOOLS__?.getEvent('req_summary')).toMatchObject({
      body: { token: 'request-token' },
      response: { token: 'response-token' }
    })
  })

  it('stops client timing before sanitizing the response preview', async () => {
    const { DataApiDevtools } = await import('../dataApiDevtools')
    let sanitizing = false
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => (sanitizing ? 100 : 10))
    DataApiDevtools.exposeControlSurface()
    window.__CHERRY_DATA_API_DEVTOOLS__?.setOptions({ capturePayloads: true })

    DataApiDevtools.recordStart({ requestId: 'req_timing', method: 'GET', path: '/providers', retryAttempt: 0 })
    DataApiDevtools.recordSuccess({
      requestId: 'req_timing',
      method: 'GET',
      path: '/providers',
      response: {
        id: 'req_timing',
        status: 200,
        data: {
          get value() {
            sanitizing = true
            return 'preview'
          }
        }
      }
    })

    expect(window.__CHERRY_DATA_API_DEVTOOLS__?.getEvent('req_timing')?.clientDuration).toBe(0)
    nowSpy.mockRestore()
  })

  it('strips request, response, and error payloads by default', async () => {
    const { DataApiDevtools } = await import('../dataApiDevtools')
    DataApiDevtools.exposeControlSurface()

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
    DataApiDevtools.recordError({
      requestId: 'req_2',
      method: 'POST',
      path: '/providers',
      error: new Error('secret error details')
    })

    const events = window.__CHERRY_DATA_API_DEVTOOLS__?.snapshot() ?? []
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      state: 'success',
      method: 'POST',
      path: '/providers',
      status: 200
    })
    expect(events[0].query).toBeUndefined()
    expect(events[0].body).toBeUndefined()
    expect(events[0].response).toBeUndefined()
    expect(events[1]).toMatchObject({
      state: 'error',
      error: { message: '<payload capture disabled>' }
    })
    expect(JSON.stringify(events)).not.toContain('secret error details')
  })

  it('does not throw when payload accessors throw', async () => {
    const { DataApiDevtools } = await import('../dataApiDevtools')
    DataApiDevtools.exposeControlSurface()
    window.__CHERRY_DATA_API_DEVTOOLS__?.setOptions({ capturePayloads: true })
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
