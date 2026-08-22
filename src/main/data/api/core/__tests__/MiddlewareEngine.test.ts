import { REDACTED } from '@shared/utils/redaction'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it } from 'vitest'

import { MiddlewareEngine } from '../MiddlewareEngine'

describe('MiddlewareEngine request logging', () => {
  beforeEach(() => {
    mockMainLoggerService.debug.mockClear()
  })

  it('redacts an API key before logging a provider key request', async () => {
    const secret = 'sk-secret-that-must-not-be-logged'
    const engine = new MiddlewareEngine()

    await engine.executeMiddlewares({
      request: {
        id: 'req_api_key',
        method: 'POST',
        path: '/providers/cherryin/api-keys',
        body: { key: secret, label: 'First key' }
      },
      response: { id: 'req_api_key', status: 0 },
      data: new Map()
    })

    expect(mockMainLoggerService.debug).toHaveBeenCalledWith('Incoming request: POST /providers/cherryin/api-keys', {
      id: 'req_api_key',
      params: undefined,
      body: { key: REDACTED, label: 'First key' }
    })
    expect(JSON.stringify(mockMainLoggerService.debug.mock.calls)).not.toContain(secret)
  })
})
