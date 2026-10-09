import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'

import type { McpServer } from '@shared/data/types/mcpServer'

import { McpAuthorizationCompleted, McpOAuthCoordinator } from '../../oauth/McpOAuthCoordinator'
import { externalMcpConnectionInternals } from '../ExternalMcpConnection'

describe('ExternalMcpConnection transport fallback policy', () => {
  it('coalesces authorization before credentials can be overwritten and releases failed attempts', async () => {
    const coordinator = new McpOAuthCoordinator()
    const controller = new AbortController()
    const first = await coordinator.begin('target', controller.signal)
    const concurrent = coordinator.begin('target', controller.signal)
    first.finish()
    await expect(concurrent).rejects.toBeInstanceOf(McpAuthorizationCompleted)
    const retry = await coordinator.begin('target', controller.signal)
    const waiting = coordinator.begin('target', controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(waiting).rejects.toThrow('cancelled')
    expect(retry.signal.aborted).toBe(true)
    const fresh = await coordinator.begin('target', new AbortController().signal)
    coordinator.close()
    expect(fresh.signal.aborted).toBe(true)
  })
  it('tries the configured URL transport before its compatibility fallback', () => {
    const server = {
      baseUrl: 'https://example.com/mcp',
      type: 'sse'
    } as McpServer
    expect(externalMcpConnectionInternals.transportCandidates(server)).toEqual(['sse', 'streamableHttp'])

    server.type = 'streamableHttp'
    expect(externalMcpConnectionInternals.transportCandidates(server)).toEqual(['streamableHttp', 'sse'])
  })

  it('falls back only for endpoint-shape mismatch status codes', () => {
    expect(
      externalMcpConnectionInternals.isTransportFallbackError(
        new SdkHttpError(SdkErrorCode.ClientHttpFailedToOpenStream, 'HTTP request failed', { status: 405 })
      )
    ).toBe(true)
    expect(
      externalMcpConnectionInternals.isTransportFallbackError(
        new SdkHttpError(SdkErrorCode.ClientHttpAuthentication, 'Unauthorized', { status: 401 })
      )
    ).toBe(false)
    expect(externalMcpConnectionInternals.isTransportFallbackError(new Error('network unavailable'))).toBe(false)
  })
})
