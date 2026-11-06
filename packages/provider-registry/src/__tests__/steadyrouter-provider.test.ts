import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const providers = JSON.parse(readFileSync(join(dataDir, 'providers.json'), 'utf8')).providers as Array<{
  id: string
  name: string
  defaultChatEndpoint: string
  endpointConfigs: Record<string, { adapterFamily: string; baseUrl: string }>
  metadata: { website: { apiKey: string; docs: string; models: string; official: string } }
}>

describe('SteadyRouter provider', () => {
  it('exposes the documented endpoints and website links', () => {
    const provider = providers.find(({ id }) => id === 'steadyrouter')
    expect(provider).toBeDefined()
    expect(provider?.name).toBe('SteadyRouter')
    expect(provider?.defaultChatEndpoint).toBe('openai-chat-completions')
    expect(provider?.endpointConfigs).toEqual({
      'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.steadyrouter.com' },
      'google-generate-content': { adapterFamily: 'google', baseUrl: 'https://api.steadyrouter.com' },
      'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://api.steadyrouter.com/v1' },
      'openai-embeddings': { adapterFamily: 'openai-compatible', baseUrl: 'https://api.steadyrouter.com/v1' },
      'openai-image-generation': { adapterFamily: 'openai-compatible', baseUrl: 'https://api.steadyrouter.com/v1' },
      'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://api.steadyrouter.com/v1' }
    })
    expect(provider?.metadata.website).toEqual({
      apiKey: 'https://www.steadyrouter.com/dashboard',
      docs: 'https://www.steadyrouter.com/site/docs.html',
      models: 'https://www.steadyrouter.com/pricing',
      official: 'https://www.steadyrouter.com'
    })
    expect(new URL(provider!.metadata.website.apiKey).search).toBe('')
  })
})
