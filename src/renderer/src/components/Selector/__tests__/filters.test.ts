/**
 * Behavior tests for the model-selector tag filter predicates. Focus is on
 * the parts that are easy to silently break: the "free" substring match
 * (false-positive risk on words like `freedom-*` / `carefree-*`), the
 * capability tag dispatch, and cherryai special-casing.
 */

import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { matchesModelTag, MODEL_SELECTOR_TAGS } from '../model/filters'

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4',
    providerId: 'openai',
    modelId: 'gpt-4',
    apiModelId: 'gpt-4',
    name: 'GPT-4',
    description: '',
    group: null,
    capabilities: [],
    inputModalities: [],
    outputModalities: [],
    endpointTypes: [],
    parameterSupport: {},
    supportsStreaming: true,
    contextWindow: null,
    maxOutputTokens: null,
    reasoning: null,
    pricing: null,
    isEnabled: true,
    isHidden: false,
    sortOrder: 0,
    notes: null,
    ...overrides
  } as Model
}

describe('MODEL_SELECTOR_TAGS', () => {
  it('lists the seven tags the selector surfaces in the filter chip row', () => {
    expect(MODEL_SELECTOR_TAGS).toEqual([
      MODEL_CAPABILITY.IMAGE_RECOGNITION,
      MODEL_CAPABILITY.EMBEDDING,
      MODEL_CAPABILITY.REASONING,
      MODEL_CAPABILITY.FUNCTION_CALL,
      MODEL_CAPABILITY.WEB_SEARCH,
      MODEL_CAPABILITY.RERANK,
      'free'
    ])
  })
})

describe('matchesModelTag — capability tags', () => {
  it('matches when the model declares the matching capability', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.REASONING] })

    expect(matchesModelTag(model, MODEL_CAPABILITY.REASONING)).toBe(true)
  })

  it('does not match when the capability is absent', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })

    expect(matchesModelTag(model, MODEL_CAPABILITY.REASONING)).toBe(false)
  })

  it('dispatches each capability to its own predicate (no cross-matching)', () => {
    const model = makeModel({ capabilities: [MODEL_CAPABILITY.WEB_SEARCH] })

    expect(matchesModelTag(model, MODEL_CAPABILITY.WEB_SEARCH)).toBe(true)
    expect(matchesModelTag(model, MODEL_CAPABILITY.RERANK)).toBe(false)
    expect(matchesModelTag(model, MODEL_CAPABILITY.EMBEDDING)).toBe(false)
  })
})

describe('matchesModelTag — "free" tag', () => {
  it('treats every cherryai-provider model as free regardless of name', () => {
    // cherryai is the in-app trial provider; its models are always free.
    const model = makeModel({ providerId: 'cherryai', name: 'Qwen3-8B', id: 'cherryai::Qwen/Qwen3-8B' })

    expect(matchesModelTag(model, 'free')).toBe(true)
  })

  it('matches when the name contains the "free" substring (case-insensitive)', () => {
    const model = makeModel({ name: 'Llama-3-Free-8B' })

    expect(matchesModelTag(model, 'free')).toBe(true)
  })

  it('matches when apiModelId contains "free"', () => {
    const model = makeModel({ name: 'Llama-3', apiModelId: 'llama-3:free' })

    expect(matchesModelTag(model, 'free')).toBe(true)
  })

  it('accepts the substring even when embedded in a longer word (known false-positive surface)', () => {
    // "freedom" / "carefree" will match. Locking this in explicitly so a
    // future tightening of the predicate surfaces as a test change rather
    // than a silent UX regression.
    expect(matchesModelTag(makeModel({ name: 'freedom-pro' }), 'free')).toBe(true)
    expect(matchesModelTag(makeModel({ name: 'carefree-mini' }), 'free')).toBe(true)
  })

  it('returns false when no field contains "free" and provider is not cherryai', () => {
    const model = makeModel({ name: 'GPT-4', providerId: 'openai', apiModelId: 'gpt-4' })

    expect(matchesModelTag(model, 'free')).toBe(false)
  })
})
