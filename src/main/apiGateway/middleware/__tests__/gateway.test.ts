import type { NextFunction, Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gatewayMiddleware } from '../gateway'

vi.mock('../../config', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('../../../services/LoggerService', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    }))
  }
}))

const mockConfigModule = await import('../../config')
const mockConfig = mockConfigModule.config as any

describe('gatewayMiddleware', () => {
  let req: Partial<Request>
  let res: Partial<Response>
  let next: NextFunction
  let jsonMock: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    jsonMock = vi.fn()
    statusMock = vi.fn(() => ({ json: jsonMock }))
    next = vi.fn()

    req = {
      params: {},
      path: '/chat/completions',
      baseUrl: '/v1',
      body: {}
    }

    res = {
      status: statusMock
    }

    vi.clearAllMocks()
    mockConfig.get.mockResolvedValue({
      modelGroups: [],
      enabledEndpoints: ['/v1/chat/completions', '/v1/messages', '/v1/responses']
    })
  })

  it('allows non-group routes using baseUrl + path normalization', async () => {
    await gatewayMiddleware(req as Request, res as Response, next)

    expect(next).toHaveBeenCalled()
    expect(statusMock).not.toHaveBeenCalled()
  })

  it('allows group routes by stripping group prefix from baseUrl + path', async () => {
    req = {
      ...req,
      params: { groupId: 'group-a' },
      baseUrl: '/group-a',
      path: '/v1/chat/completions'
    }

    mockConfig.get.mockResolvedValue({
      modelGroups: [
        {
          id: 'group-a',
          mode: 'model',
          providerId: 'openai',
          modelId: 'gpt-4.1'
        }
      ],
      enabledEndpoints: ['/v1/chat/completions']
    })

    await gatewayMiddleware(req as Request, res as Response, next)

    expect(next).toHaveBeenCalled()
    expect(statusMock).not.toHaveBeenCalled()
    expect(req.body).toMatchObject({ model: 'openai:gpt-4.1' })
  })

  it('blocks disabled endpoints after stable normalization', async () => {
    req = {
      ...req,
      baseUrl: '/v1',
      path: '/responses'
    }

    mockConfig.get.mockResolvedValue({
      modelGroups: [],
      enabledEndpoints: ['/v1/messages']
    })

    await gatewayMiddleware(req as Request, res as Response, next)

    expect(statusMock).toHaveBeenCalledWith(404)
    expect(jsonMock).toHaveBeenCalledWith({
      error: {
        type: 'not_found',
        message: 'Endpoint /responses is not enabled'
      }
    })
    expect(next).not.toHaveBeenCalled()
  })
})
