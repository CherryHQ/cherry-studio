import { ProtocolError, SdkError, SdkErrorCode, UnauthorizedError } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'

import { shouldReportFailure } from '@shared/utils/errorReporting'

import { classifyMcpFailure, McpConfigurationError } from '../failureFacts'

describe('MCP failure classification', () => {
  it.each([SdkErrorCode.RequestTimeout, SdkErrorCode.ConnectionClosed, SdkErrorCode.InvalidResult])(
    'distinguishes external %s from a built-in server regression',
    (code) => {
      const error = new SdkError(code, 'MCP failed')
      expect(shouldReportFailure(classifyMcpFailure(error, true))).toBe(false)
      expect(shouldReportFailure(classifyMcpFailure(error, false))).toBe(true)
    }
  )

  it('retains connection state defects even for external servers', () => {
    for (const error of [
      new SdkError(SdkErrorCode.NotInitialized, 'No session'),
      new SyntaxError('Invalid MCP JSON'),
      new TypeError('network failed')
    ]) {
      expect(classifyMcpFailure(error, true).kind).toBe('defect')
    }
  })

  it('does not hide connection-state defects behind a transport cause', () => {
    const transport = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
    const failure = new SdkError(SdkErrorCode.NotConnected, 'Not connected', undefined, { cause: transport })
    expect(classifyMcpFailure(failure, true)).toMatchObject({ kind: 'defect', reason: 'connection_state' })
    const wrapped = new SdkError(SdkErrorCode.EraNegotiationFailed, 'Handshake failed', undefined, { cause: failure })
    expect(shouldReportFailure(classifyMcpFailure(wrapped, true))).toBe(true)
  })

  it('keeps cyclic causes reportable without looping', () => {
    const first = new Error('Unknown external failure')
    const second = new Error('Wrapper', { cause: first })
    first.cause = second
    expect(shouldReportFailure(classifyMcpFailure(first, true))).toBe(true)
    const state = new SdkError(SdkErrorCode.NotConnected, 'Not connected', undefined, { cause: first })
    expect(classifyMcpFailure(state, true)).toMatchObject({ kind: 'defect', reason: 'connection_state' })
  })

  it('keeps auth, configuration, remote rejection and cancellation local', () => {
    for (const error of [
      new UnauthorizedError('Sign in'),
      new McpConfigurationError('Tool disabled'),
      new ProtocolError(-32602, 'Invalid parameters')
    ]) {
      expect(shouldReportFailure(classifyMcpFailure(error, true))).toBe(false)
    }
    expect(shouldReportFailure(classifyMcpFailure(new Error('shutdown'), false, true))).toBe(false)
    expect(shouldReportFailure(classifyMcpFailure(new Error('MCP connection issue'), true))).toBe(true)
  })
})
