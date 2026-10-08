import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { inferReasoningControls } from '../patterns/reasoning-heuristics'
import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})
const efforts = ['low', 'medium', 'high', 'xhigh', 'max']

describe('MiniMax M3.1 Flash Preview catalog', () => {
  it('exposes the official multimodal model and always-on five-tier reasoning', () => {
    expect(loader.findModel('MiniMax-M3.1-Flash-Preview')).toMatchObject({
      name: 'MiniMax-M3.1-Flash-Preview',
      contextWindow: 1_000_000,
      inputModalities: ['text', 'image', 'video'],
      capabilities: expect.arrayContaining(['reasoning', 'function-call', 'image-recognition', 'video-recognition']),
      reasoning: {
        controls: [{ kind: 'effort', values: efforts, default: 'max' }],
        supportedEfforts: efforts,
        defaultEffort: 'max'
      }
    })
  })

  it.each(['MiniMax-M3.1-Flash-Preview', 'minimax-m3-1-flash-preview', 'MiniMaxAI/MiniMax-M3.1-Flash-Preview'])(
    'infers five tiers for custom-provider ID %s without adding an off switch',
    (id) => expect(inferReasoningControls(id)).toEqual([{ kind: 'effort', values: efforts }])
  )

  it.each(['minimax', 'minimax-global'])('uses the exact API ID and both supported endpoints on %s', (providerId) => {
    expect(loader.findOverride(providerId, 'minimax-m3-1-flash-preview')).toMatchObject({
      apiModelId: 'MiniMax-M3.1-Flash-Preview',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages']
    })
  })

  it('does not apply the new effort ladder to older or unannounced MiniMax models', () => {
    expect(loader.findModel('minimax-m3')?.reasoning?.controls).toEqual([{ kind: 'toggle' }])
    for (const id of ['MiniMax-M2.7', 'MiniMax-M3', 'MiniMax-M3.2-Flash-Preview']) {
      expect(inferReasoningControls(id)).toBeUndefined()
    }
  })
})
