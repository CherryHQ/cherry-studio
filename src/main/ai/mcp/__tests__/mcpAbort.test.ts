import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { isMcpCancellation } from '../mcpAbort'

describe('isMcpCancellation', () => {
  it('is false while the signal has not aborted, whatever the error looks like', () => {
    const controller = new AbortController()
    expect(isMcpCancellation(new DOMException('aborted', 'AbortError'), controller.signal)).toBe(false)
  })

  it('matches the signal reason itself', () => {
    const reason = new Error('user stopped')
    const controller = new AbortController()
    controller.abort(reason)
    expect(isMcpCancellation(reason, controller.signal)).toBe(true)
  })

  it('matches an AbortError raised on the signal behalf', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isMcpCancellation(new DOMException('aborted', 'AbortError'), controller.signal)).toBe(true)
  })

  it('matches the MCP SDK abort wrapper (McpError with the request-timeout code)', () => {
    const controller = new AbortController()
    controller.abort(new Error('user stopped'))
    const sdkWrapper = new McpError(ErrorCode.RequestTimeout, 'Error: user stopped')
    expect(isMcpCancellation(sdkWrapper, controller.signal)).toBe(true)
  })

  it('does not classify a genuine failure that raced the abort as cancellation', () => {
    const controller = new AbortController()
    controller.abort(new Error('user stopped'))
    expect(isMcpCancellation(new Error('connection reset'), controller.signal)).toBe(false)
    expect(isMcpCancellation(new McpError(ErrorCode.ConnectionClosed, 'connection closed'), controller.signal)).toBe(
      false
    )
  })
})
