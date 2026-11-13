import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { selectClientIdentity } from '../clientIdentity'

const provider = {
  settings: {},
  endpointConfigs: {
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://relay.test/v1' }
  }
} as Provider
const identity = { 'user-agent': 'claude-cli/2.1.311 (external, cli)', 'x-app': 'cli', 'x-client-app': 'claude-code' }
const input = () => ({
  requestHeaders: new Headers(identity),
  provider,
  agentType: 'claude-code',
  model: { id: 'relay::claude-sonnet-4-6', modelId: 'claude-sonnet-4-6' } as never,
  forbiddenValues: [],
  endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
})

describe('selectClientIdentity', () => {
  it('preserves only the three normalized identity names', async () => {
    const requestHeaders = new Headers({
      'User-Agent': identity['user-agent'],
      'X-App': 'cli',
      'X-Client-App': 'claude-code',
      authorization: 'Bearer private',
      'x-api-key': 'private',
      'x-cherry-agent-session-id': 'session',
      'anthropic-beta': 'beta',
      connection: 'keep-alive'
    })
    expect(await selectClientIdentity({ ...input(), requestHeaders })).toEqual(identity)
  })
  it.each(['pi', undefined, 'Claude-Code'])('rejects forged identity for agent type %s', async (agentType) => {
    expect(await selectClientIdentity({ ...input(), agentType })).toBeUndefined()
  })
  it.each([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_RESPONSES, undefined])(
    'rejects endpoint %s',
    async (endpointType) => {
      expect(await selectClientIdentity({ ...input(), endpointType })).toBeUndefined()
    }
  )
  it('skips missing and whitespace values and trims surviving values', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        requestHeaders: new Headers({ 'x-app': '  ', 'X-Client-App': ' cli ' })
      })
    ).toEqual({ 'x-client-app': 'cli' })
  })
  it('excludes Connection nominees case insensitively', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        requestHeaders: new Headers({ ...identity, connection: 'keep-alive, User-Agent, X-APP' })
      })
    ).toEqual({ 'x-client-app': 'claude-code' })
  })
  it('excludes values containing the presented internal credential', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        forbiddenValues: ['private-token'],
        requestHeaders: new Headers({ ...identity, 'user-agent': 'claude-cli/private-token', 'x-app': 'private-token' })
      })
    ).toEqual({ 'x-client-app': 'claude-code' })
  })
  it('gives non-empty provider headers priority regardless of casing', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        provider: {
          ...provider,
          settings: { extraHeaders: { 'User-Agent': 'relay', 'X-APP': 'configured', 'X-Client-App': '  ' } }
        }
      })
    ).toEqual({ 'x-client-app': 'claude-code' })
  })
  it('uses the last case-insensitive provider value when an override is cleared', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        provider: { ...provider, settings: { extraHeaders: { 'x-app': 'provider', 'X-App': '' } } }
      })
    ).toEqual(identity)
  })
  it.each([undefined, 'unknown-adapter'])(
    'rejects an Anthropic label with adapter family %s',
    async (adapterFamily) => {
      expect(
        await selectClientIdentity({
          ...input(),
          provider: {
            ...provider,
            endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.test', adapterFamily } }
          }
        })
      ).toBeUndefined()
    }
  )
  it('rejects missing endpoint configuration', async () => {
    expect(await selectClientIdentity({ ...input(), provider: { ...provider, endpointConfigs: {} } })).toBeUndefined()
  })
  it('rejects an unknown adapter even on a known preset', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        provider: {
          ...provider,
          id: 'cherryin',
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'unknown-adapter', baseUrl: 'https://relay.test/v1' }
          }
        }
      })
    ).toBeUndefined()
  })
  it('excludes a runtime capability pasted into x-app', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        forbiddenValues: ['capability-secret'],
        requestHeaders: new Headers({ 'x-app': 'capability-secret' })
      })
    ).toBeUndefined()
  })
  it('uses the last nonempty provider collision value', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        provider: { ...provider, settings: { extraHeaders: { 'X-App': '', 'x-app': 'p' } } }
      })
    ).toEqual({ 'user-agent': identity['user-agent'], 'x-client-app': 'claude-code' })
  })
  it.each(['anthropic', 'azure-anthropic', 'newapi', 'aihubmix', 'dmxapi', 'cherryin'])(
    'admits the constructed Anthropic transport for %s',
    async (family) => {
      expect(
        await selectClientIdentity({
          ...input(),
          provider: {
            ...provider,
            id: family,
            presetProviderId: family,
            endpointConfigs: {
              [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: family, baseUrl: 'https://relay.test/v1' }
            }
          }
        })
      ).toEqual(identity)
    }
  )
  it('rejects Ollama even when its advertised adapter is Anthropic', async () => {
    expect(
      await selectClientIdentity({ ...input(), provider: { ...provider, id: 'ollama', presetProviderId: 'ollama' } })
    ).toBeUndefined()
  })
  it('rejects a preset model that constructs an OpenAI transport', async () => {
    expect(
      await selectClientIdentity({
        ...input(),
        model: { id: 'relay::gpt-5', modelId: 'gpt-5' } as never,
        provider: {
          ...provider,
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'aihubmix', baseUrl: 'https://relay.test/v1' }
          }
        }
      })
    ).toBeUndefined()
  })
  it('returns undefined when no identity survives', async () => {
    expect(await selectClientIdentity({ ...input(), requestHeaders: new Headers() })).toBeUndefined()
    expect(
      await selectClientIdentity({
        ...input(),
        requestHeaders: new Headers({ ...identity, connection: 'user-agent, x-app, x-client-app' })
      })
    ).toBeUndefined()
  })
})
