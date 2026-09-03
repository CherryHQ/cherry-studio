import https from 'node:https'

import { describe, expect, it, vi } from 'vitest'

import { NodeProxyBackend } from '../NodeProxyBackend'

function bindWithSharedAgent() {
  const backend = new NodeProxyBackend()
  const sharedProxyAgent = new https.Agent()
  const originalMethod = vi.fn()
  // bindHttpMethod is private; exercise the bound wrapper directly
  const bound = (backend as any).bindHttpMethod(originalMethod, sharedProxyAgent) as (...args: unknown[]) => unknown
  return { bound, originalMethod, sharedProxyAgent }
}

describe('NodeProxyBackend request binding', () => {
  it('propagates the caller agent TLS stance per-request without mutating the shared proxy agent', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/backup', { agent: new https.Agent({ rejectUnauthorized: false }) })

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.rejectUnauthorized).toBe(false)
    expect(forwardedOptions.agent).toBe(sharedProxyAgent)
    expect(sharedProxyAgent.options.rejectUnauthorized).not.toBe(false)
  })

  it('keeps a strict caller agent strict on the forwarded request', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/backup', { agent: new https.Agent({ rejectUnauthorized: true }) })

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.rejectUnauthorized).toBe(true)
    expect(sharedProxyAgent.options.rejectUnauthorized).not.toBe(false)
  })

  it('routes agentless requests through the shared proxy agent without injecting TLS options', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/api', {})

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.agent).toBe(sharedProxyAgent)
    expect('rejectUnauthorized' in forwardedOptions).toBe(false)
  })

  it('does not inject TLS options when the caller agent carries no explicit stance (default verifies)', () => {
    const { bound, originalMethod, sharedProxyAgent } = bindWithSharedAgent()

    bound('https://example.test/backup', { agent: new https.Agent() })

    const forwardedOptions = originalMethod.mock.calls[0][1]
    expect(forwardedOptions.agent).toBe(sharedProxyAgent)
    expect('rejectUnauthorized' in forwardedOptions).toBe(false)
  })
})
