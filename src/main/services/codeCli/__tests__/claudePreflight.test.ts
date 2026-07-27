import { beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => loggerMock }
}))

import { preflightClaudeEndpoint } from '../claudePreflight'

const input = {
  baseUrl: 'https://open.cherryin.net',
  apiKey: 'enterprise-secret-key',
  model: 'kimi-k3'
}

describe('preflightClaudeEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('joins the final messages route once and mirrors ANTHROPIC_AUTH_TOKEN bearer auth', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }))

    await expect(preflightClaudeEndpoint(input, fetchMock)).resolves.toEqual({
      success: true,
      category: 'ok',
      statusCode: 200
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.cherryin.net/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer enterprise-secret-key' })
      })
    )
    expect(fetchMock.mock.calls[0][0]).not.toContain('/v1/v1/')
  })

  it.each([
    [401, '{"error":{"message":"Invalid token"}}', 'authentication'],
    [404, '{"error":{"message":"Not Found"}}', 'route'],
    [404, '{"error":{"message":"The selected model was not found"}}', 'model'],
    [500, '{"error":{"message":"Gateway unavailable"}}', 'service']
  ] as const)('classifies HTTP %s as %s', async (status, body, category) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }))

    await expect(preflightClaudeEndpoint(input, fetchMock)).resolves.toEqual({
      success: false,
      category,
      statusCode: status
    })
  })

  it('classifies network failures without logging the key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'))

    await expect(preflightClaudeEndpoint(input, fetchMock)).resolves.toEqual({
      success: false,
      category: 'service',
      statusCode: null
    })

    expect(JSON.stringify([...loggerMock.info.mock.calls, ...loggerMock.warn.mock.calls])).not.toContain(input.apiKey)
  })
})
