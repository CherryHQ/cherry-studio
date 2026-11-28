import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataRequest, DataResponse, RequestContext } from '@shared/data/api/types'

import { MiddlewareEngine } from '../MiddlewareEngine'

describe('MiddlewareEngine request logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not log request parameters or body', async () => {
    const apiKey = `sk-${'A'.repeat(24)}`
    const request: DataRequest = {
      id: 'request-1',
      method: 'POST',
      path: '/providers',
      params: { token: 'parameter-secret' },
      body: { apiKeys: [{ key: apiKey }] }
    }
    const context: RequestContext = {
      request,
      response: { id: request.id, status: 0 } as DataResponse,
      data: new Map()
    }

    await new MiddlewareEngine().executeMiddlewares(context)

    expect(mockMainLoggerService.debug).toHaveBeenNthCalledWith(1, 'Incoming request: POST /providers', {
      id: request.id
    })
    expect(JSON.stringify(mockMainLoggerService.debug.mock.calls)).not.toContain(apiKey)
    expect(JSON.stringify(mockMainLoggerService.debug.mock.calls)).not.toContain('parameter-secret')
  })
})
