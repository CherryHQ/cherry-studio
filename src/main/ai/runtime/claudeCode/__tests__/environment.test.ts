import { describe, expect, it } from 'vitest'

import { resolveAutoCompactWindow } from '../environment'

// Unit coverage for the trust gate and budget matrix behind
// buildClaudeCodeSessionSettings: the settings-builder suite keeps the
// integrated provider-passthrough and env-pin contracts, while the pure
// window/budget arithmetic lives here so the omnibus file stops growing.
describe('resolveAutoCompactWindow', () => {
  // The two-room fallback keeps the margin for a 200K untrusted declaration even
  // though its margined room (88K) sits below the SDK floor: only when both rooms
  // are below the floor does the raw window win.
  it('keeps the safety margin for a 200K untrusted declaration above the SDK floor', () => {
    expect(
      resolveAutoCompactWindow(200_000, 32_000, {
        id: 'openrouter',
        presetProviderId: 'openrouter',
        defaultChatEndpoint: 'openai-chat-completions'
      } as never)
    ).toBe(100_000)
  })

  // A custom provider cloned from the Anthropic preset reports an accurate
  // window while it keeps the official endpoint, so it must not pay the 0.6 margin.
  it('trusts a custom provider that keeps the official Anthropic endpoint', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'my-anthropic-relay',
        presetProviderId: 'anthropic',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'https://api.anthropic.com' }
        }
      } as never)
    ).toBe(219_520)
  })

  // A custom provider keeping the official endpoint stays trusted with a full
  // route path, not just the bare base URL or a `/v1` suffix.
  it('trusts a custom provider that keeps the official Anthropic endpoint with a route path', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'my-anthropic-relay',
        presetProviderId: 'anthropic',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'https://api.anthropic.com/v1/messages' }
        }
      } as never)
    ).toBe(219_520)
  })

  // A lookalike hostname is still an untrusted relay even though it contains
  // the official hostname.
  it('distrusts a lookalike Anthropic hostname', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'anthropic-lookalike',
        presetProviderId: 'anthropic',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'https://api.anthropic.com.evil.com/v1' }
        }
      } as never)
    ).toBe(119_168)
  })

  // A relay speaking the Anthropic protocol with no endpoint configuration cannot
  // show where its traffic goes, so the absent entry fails closed to untrusted.
  it('distrusts an Anthropic-protocol relay with an absent endpoint configuration', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'my-anthropic-relay',
        presetProviderId: 'my-anthropic-relay',
        defaultChatEndpoint: 'anthropic-messages'
      } as never)
    ).toBe(119_168)
  })

  // A first-party channel whose endpoint entry carries no baseUrl (Bedrock-style
  // SigV4 transport) has nothing to spoof, so the present entry stays trusted.
  it('trusts an Anthropic-protocol channel whose present endpoint entry has no baseUrl', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'aws-bedrock',
        presetProviderId: 'aws-bedrock',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { adapterFamily: 'bedrock' }
        }
      } as never)
    ).toBe(219_520)
  })

  // A present but URL-less entry with a URL-based adapter still resolves through
  // the getBaseUrl cascade to another entry's host, so it stays untrusted.
  it('distrusts a URL-less Anthropic-protocol entry on a URL-based adapter', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'my-anthropic-relay',
        presetProviderId: 'my-anthropic-relay',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { adapterFamily: 'anthropic' }
        }
      } as never)
    ).toBe(119_168)
  })

  // Plain HTTP on the official host proves a middlebox, not the official endpoint.
  it('distrusts plain HTTP on the official Anthropic host', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'anthropic',
        presetProviderId: 'anthropic',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { baseUrl: 'http://api.anthropic.com' }
        }
      } as never)
    ).toBe(119_168)
  })

  // A preset-Anthropic provider with an empty-string entry URL is untrusted:
  // empty is falsy at runtime (getBaseUrl cascade, warmup `|| baseUrl`), so
  // traffic can still reach a relay. Only an absent or explicitly official
  // entry keeps the preset trust.
  it('distrusts a preset-Anthropic provider with an empty entry URL', () => {
    expect(
      resolveAutoCompactWindow(256_000, 32_000, {
        id: 'anthropic',
        presetProviderId: 'anthropic',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: {
          'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: '' }
        }
      } as never)
    ).toBe(119_168)
  })
})
