import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { inferReasoningControls, inferReasoningMembership } from '../patterns/reasoning-heuristics'
import { ModelListSchema } from '../schemas/model'

describe('Gemini 4 Argon', () => {
  it('exposes the documented limits and always-on, level-based reasoning', () => {
    const catalog = ModelListSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../data/models.json'), 'utf8')))
    const model = catalog.models.find((entry) => entry.id === 'gemini-4-argon')!
    expect(model).toMatchObject({
      name: 'Gemini 4 Argon',
      contextWindow: 1_048_576,
      maxOutputTokens: 1_048_576,
      inputModalities: ['text', 'image', 'audio', 'video'],
      outputModalities: ['text'],
      reasoning: {
        wireDialect: 'effort',
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'], default: 'medium' }],
        defaultEffort: 'medium'
      },
      parameterSupport: {
        temperature: { supported: false },
        topP: { supported: false },
        topK: { supported: false }
      }
    })
    expect(model.capabilities).toEqual(expect.arrayContaining(['reasoning', 'function-call', 'file-input']))
    expect(model.capabilities).not.toEqual(expect.arrayContaining(['image-generation']))
    expect(model.capabilities).not.toEqual(expect.arrayContaining(['audio-generation']))
  })

  it.each(['gemini-4-argon', 'google/gemini-4-argon', 'models/gemini-4-argon'])(
    'recognizes %s on custom providers without a thinking-budget fallback',
    (id) => {
      expect(inferReasoningMembership(id)).toBe(true)
      expect(inferReasoningControls(id)).toEqual([{ kind: 'effort', values: ['low', 'medium', 'high'] }])
    }
  )
})
