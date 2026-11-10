import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { inferReasoningControls } from '../patterns/reasoning-heuristics'
import { createRegistry } from '../registry'

const registry = createRegistry(bundledCatalog)

describe('stable LongCat 2.5 catalog', () => {
  it('exposes the official multimodal model with the documented limits and fixed temperature', () => {
    expect(registry.findModel('LongCat-2.5')).toMatchObject({
      id: 'longcat-2-5',
      ownedBy: 'meituan',
      contextWindow: 1_048_576,
      maxOutputTokens: 262_144,
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      capabilities: expect.arrayContaining(['function-call', 'reasoning', 'image-recognition', 'video-recognition']),
      reasoning: { controls: [{ kind: 'toggle' }] }
    })
    expect(registry.findOverride('longcat', 'LongCat-2.5')).toMatchObject({
      apiModelId: 'LongCat-2.5',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages', 'openai-responses'],
      parameterSupport: { temperature: { supported: false } },
      reasoningContracts: {
        'openai-responses': {
          support: { controls: [{ kind: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] }] }
        }
      }
    })
  })

  it.each(['LongCat-2.5', 'longcat-2-5', 'meituan/LongCat-2.5'])(
    'recognizes the stable model thinking switch for custom-provider ID %s',
    (id) => expect(inferReasoningControls(id)).toEqual([{ kind: 'toggle' }])
  )

  it('preserves LongCat 2.0 limits and endpoints', () => {
    expect(registry.findModel('LongCat-2.0')?.maxOutputTokens).toBe(131_072)
    expect(registry.findOverride('longcat', 'LongCat-2.0')?.endpointTypes).toEqual([
      'openai-chat-completions',
      'anthropic-messages'
    ])
  })
})
