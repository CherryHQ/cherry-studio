import { describe, expect, it } from 'vitest'

import { McpOAuthClientProvider } from '../provider'

describe('McpOAuthClientProvider OAuth state', () => {
  it('generates and exposes a high-entropy pending state', () => {
    const provider = new McpOAuthClientProvider({
      serverUrlHash: 'server-hash',
      configDir: '/tmp/cherry-studio-oauth-test'
    })

    expect(() => provider.getExpectedState()).toThrow('No OAuth state saved for session')

    const state = provider.state()

    expect(state).toHaveLength(43)
    expect(provider.getExpectedState()).toBe(state)
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('clears the pending state after the flow finishes', () => {
    const provider = new McpOAuthClientProvider({
      serverUrlHash: 'server-hash',
      configDir: '/tmp/cherry-studio-oauth-test'
    })

    provider.state()
    provider.clearExpectedState()

    expect(() => provider.getExpectedState()).toThrow('No OAuth state saved for session')
  })
})
