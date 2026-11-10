import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

describe('LongCat-2.5-Preview catalog', () => {
  it('resolves the Preview entry and records its announced image input', () => {
    const registry = createRegistry(bundledCatalog)

    expect(registry.findModel('LongCat-2.5-Preview')).toMatchObject({
      id: 'longcat-2-5-preview',
      ownedBy: 'meituan',
      capabilities: expect.arrayContaining(['function-call', 'reasoning', 'image-recognition']),
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1048576,
      maxOutputTokens: 262144,
      reasoning: { controls: [{ kind: 'toggle' }] }
    })
    expect(registry.findModel('longcat-2-5-preview')?.capabilities).toContain('image-recognition')
    expect(registry.findOverride('longcat', 'LongCat-2.5-Preview')).toMatchObject({
      apiModelId: 'LongCat-2.5-Preview',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages']
    })
  })
})
