import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { isLoginBasedProvider } from '../provider'

const withAuthMethods = (authMethods?: Provider['authMethods']): Pick<Provider, 'authMethods'> => ({ authMethods })

describe('isLoginBasedProvider', () => {
  it('is false when authMethods is absent (defaults to api-key)', () => {
    expect(isLoginBasedProvider(withAuthMethods(undefined))).toBe(false)
  })

  it('is false for an explicit api-key provider', () => {
    expect(isLoginBasedProvider(withAuthMethods(['api-key']))).toBe(false)
  })

  it('is true for OAuth-only providers (codex / grok)', () => {
    expect(isLoginBasedProvider(withAuthMethods(['oauth']))).toBe(true)
  })

  it('is true for external-cli providers (claude-code)', () => {
    expect(isLoginBasedProvider(withAuthMethods(['external-cli']))).toBe(true)
  })

  // CherryIN accepts both a user key and an OAuth login — its api-key inputs must
  // stay, so it is NOT login-based even though it offers OAuth.
  it('is false for a multi-auth provider that still takes an api-key (cherryin)', () => {
    expect(isLoginBasedProvider(withAuthMethods(['api-key', 'oauth']))).toBe(false)
  })

  it('is false for an empty method list', () => {
    expect(isLoginBasedProvider(withAuthMethods([]))).toBe(false)
  })
})
