import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

describe('Coding model catalog', () => {
  const registry = createRegistry(bundledCatalog)

  it.each([
    ['cursor/composer-2.5', 2.5],
    ['composer-2.5-fast', 15]
  ])('recognizes %s with the documented context and list rate', (id, outputRate) => {
    expect(registry.findModel(id)).toMatchObject({
      ownedBy: 'cursor',
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 200000,
      pricing: { output: { perMillionTokens: outputRate } }
    })
  })

  it('keeps the Grok CLI route addressable while resolving Composer metadata', () => {
    const route = registry.findOverride('grok-cli', 'grok-composer-2.5-fast')
    expect(route).toMatchObject({
      apiModelId: 'grok-composer-2.5-fast',
      endpointTypes: ['openai-responses']
    })
    expect(registry.findModel(route?.modelId ?? '')).toMatchObject({ ownedBy: 'cursor', name: 'Composer 2.5 Fast' })
  })

  it.each([
    ['cognition/swe-2.1', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['swe-2.1-ultrafast', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['swe-2', ['medium', 'high', 'max']],
    ['swe-2-flash', ['medium', 'high', 'max']]
  ])('recognizes %s with the published reasoning levels', (id, efforts) => {
    expect(registry.findModel(id)).toMatchObject({
      ownedBy: 'cognition',
      inputModalities: ['text'],
      outputModalities: ['text'],
      reasoning: { supportedEfforts: efforts }
    })
  })

  it.each(['swe-1.6', 'swe-1.7'])('recognizes the earlier %s coding model', (id) => {
    expect(registry.findModel(id)).toMatchObject({
      ownedBy: 'cognition',
      capabilities: expect.arrayContaining(['function-call', 'reasoning'])
    })
  })
})
