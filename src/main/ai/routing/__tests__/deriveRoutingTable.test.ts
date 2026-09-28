import { describe, expect, it } from 'vitest'

import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import { MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { MODEL_HEALTH_STALE_AFTER_MS } from '@shared/utils/modelHealth'

import { deriveRoutingTable, type RoutableModel } from '../deriveRoutingTable'

function model(id: string, capabilities: string[] = [MODEL_CAPABILITY.FUNCTION_CALL]): RoutableModel {
  return { id: id as UniqueModelId, providerId: id.split('::')[0]!, capabilities }
}

const noHealth: ModelHealthMemory = {}
const noneExhausted = new Set<string>()

function idsFor(table: ReturnType<typeof deriveRoutingTable>, category: 'code' | 'image' | 'general'): string[] {
  return table[category].map((candidate) => candidate.id)
}

describe('deriveRoutingTable', () => {
  it('ranks by capability on a fresh install, before any model has been probed', () => {
    const table = deriveRoutingTable({
      models: [model('groq::llama-3.2-3b'), model('openai::gpt-5.6'), model('cerebras::gemma-2-9b')],
      health: noHealth,
      exhaustedProviderIds: noneExhausted
    })

    // The promise of the feature: pasting keys is enough, no probe and no manual mapping required.
    expect(idsFor(table, 'general')[0]).toBe('openai::gpt-5.6')
    expect(table.general).toHaveLength(3)
  })

  it('ranks a model that failed its last probe below a weaker one that answers', () => {
    const health: ModelHealthMemory = {
      ['openai::gpt-5.6' as UniqueModelId]: { ok: false, checkedAt: Date.now() },
      ['groq::llama-3.2-3b' as UniqueModelId]: { ok: true, checkedAt: Date.now() }
    }

    const ids = idsFor(
      deriveRoutingTable({
        models: [model('openai::gpt-5.6'), model('groq::llama-3.2-3b')],
        health,
        exhaustedProviderIds: noneExhausted
      }),
      'general'
    )

    expect(ids[0]).toBe('groq::llama-3.2-3b')
    // Demoted, not dropped — the provider may have recovered since the probe.
    expect(ids).toContain('openai::gpt-5.6')
  })

  it('stops ranking a failed probe below a healthy one once both are older than the staleness window', () => {
    const stale = Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1
    const health: ModelHealthMemory = {
      ['openai::gpt-5.6' as UniqueModelId]: { ok: false, checkedAt: stale },
      ['groq::llama-3.2-3b' as UniqueModelId]: { ok: true, checkedAt: stale }
    }

    const ids = idsFor(
      deriveRoutingTable({
        models: [model('openai::gpt-5.6'), model('groq::llama-3.2-3b')],
        health,
        exhaustedProviderIds: noneExhausted
      }),
      'general'
    )

    // Neither an old failure nor an old success is evidence about right now, so quality alone decides.
    expect(ids[0]).toBe('openai::gpt-5.6')
  })

  it('treats the exact staleness boundary as expired, not fresh', () => {
    const boundary = Date.now() - MODEL_HEALTH_STALE_AFTER_MS
    const health: ModelHealthMemory = { ['openai::gpt-5.6' as UniqueModelId]: { ok: false, checkedAt: boundary } }

    const ids = idsFor(
      deriveRoutingTable({
        models: [model('openai::gpt-5.6'), model('groq::llama-3.2-3b')],
        health,
        exhaustedProviderIds: noneExhausted
      }),
      'general'
    )

    expect(ids[0]).toBe('openai::gpt-5.6')
  })

  it('keeps a model whose provider is out of quota, ranked last', () => {
    const ids = idsFor(
      deriveRoutingTable({
        models: [model('openai::gpt-5.6'), model('groq::llama-3.2-3b')],
        health: noHealth,
        exhaustedProviderIds: new Set(['openai'])
      }),
      'general'
    )

    expect(ids).toEqual(['groq::llama-3.2-3b', 'openai::gpt-5.6'])
  })

  it('never offers an embedding or rerank model, which cannot answer a chat turn', () => {
    const table = deriveRoutingTable({
      models: [
        model('openai::text-embedding-3-large', [MODEL_CAPABILITY.EMBEDDING]),
        model('voyageai::rerank-2', [MODEL_CAPABILITY.RERANK]),
        model('groq::llama-3.2-3b')
      ],
      health: noHealth,
      exhaustedProviderIds: noneExhausted
    })

    expect(idsFor(table, 'general')).toEqual(['groq::llama-3.2-3b'])
  })

  it('prefers a native image model for image work without discarding tool-calling chat models', () => {
    const table = deriveRoutingTable({
      models: [
        model('openai::gpt-5.6'),
        // Declares text output too, so it can also answer a chat turn.
        { ...model('modelscope::flux-dev', [MODEL_CAPABILITY.IMAGE_GENERATION]), outputModalities: ['text', 'image'] }
      ],
      health: noHealth,
      exhaustedProviderIds: noneExhausted
    })

    expect(idsFor(table, 'image')[0]).toBe('modelscope::flux-dev')
    // The chat model still reaches the image tool, so it stays as a fallback.
    expect(idsFor(table, 'image')).toContain('openai::gpt-5.6')
    // ...but it outranks the image model everywhere else.
    expect(idsFor(table, 'code')[0]).toBe('openai::gpt-5.6')
  })

  it('offers a text-to-image model for images only, never for work it cannot do', () => {
    const table = deriveRoutingTable({
      models: [
        model('groq::llama-3.2-3b'),
        {
          ...model('modelscope::flux-dev', [MODEL_CAPABILITY.IMAGE_GENERATION]),
          outputModalities: ['image']
        }
      ],
      health: noHealth,
      exhaustedProviderIds: noneExhausted
    })

    expect(idsFor(table, 'image')[0]).toBe('modelscope::flux-dev')
    // Easy work picks the weakest candidate, so leaving it here would route code to an image model.
    expect(idsFor(table, 'code')).toEqual(['groq::llama-3.2-3b'])
  })

  it('returns every category even when no model is available', () => {
    const table = deriveRoutingTable({ models: [], health: noHealth, exhaustedProviderIds: noneExhausted })

    // Callers index by category unconditionally; a missing key would throw on the send path.
    expect(Object.keys(table).sort()).toEqual(['code', 'general', 'image', 'research', 'writing'])
    expect(table.code).toEqual([])
  })

  it('caps each category so an aggregator returning hundreds of models stays bounded', () => {
    const models = Array.from({ length: 50 }, (_, i) => model(`openrouter::model-${i}`))

    expect(deriveRoutingTable({ models, health: noHealth, exhaustedProviderIds: noneExhausted }).code).toHaveLength(8)
  })
})
