import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('DotHoosh provider', () => {
  // Agent exports (OpenCode, Pi, Hermes) pick their transport from the endpoint configs, so Responses must be declared.
  it('declares a Bearer-only Responses connection next to Chat Completions and Anthropic Messages', () => {
    const endpoints = loader.findProvider('dothoosh')?.endpointConfigs
    expect(endpoints?.['openai-responses']).toEqual({
      adapterFamily: 'openai',
      baseUrl: 'https://gateway.dothoosh.com'
    })
    expect(Object.keys(endpoints ?? {})).toEqual(
      expect.arrayContaining(['openai-chat-completions', 'anthropic-messages'])
    )
  })
})
