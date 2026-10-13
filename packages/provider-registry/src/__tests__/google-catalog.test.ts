import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { inferReasoningControls } from '../patterns/reasoning-heuristics'
import { SERVER_TOOL_FUNCTION_MIXING_MODEL_IDS } from '../patterns/server-tool-constraints.gen'
import { isServerToolModelEligible } from '../patterns/serverToolModelEligibility'
import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Gemini 4 Argon catalog', () => {
  it('exposes the stable multimodal model with the single streaming hop limit', () => {
    expect(loader.findModel('gemini-4-argon')).toMatchObject({
      name: 'Gemini 4 Argon',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      inputModalities: ['text', 'image', 'video', 'audio'],
      outputModalities: ['text'],
      parameterSupport: {
        temperature: { supported: false },
        topP: { supported: false },
        topK: { supported: false }
      },
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'], default: 'medium' }],
        defaultEffort: 'medium',
        wireDialect: 'effort'
      }
    })
    expect(loader.findOverride('gemini', 'gemini-4-argon')).toMatchObject({
      apiModelId: 'gemini-4-argon',
      endpointTypes: ['google-generate-content']
    })
  })

  it('infers only the supported effort ladder for custom providers', () => {
    expect(inferReasoningControls('gemini-4-argon')).toEqual([{ kind: 'effort', values: ['low', 'medium', 'high'] }])
    expect(inferReasoningControls('gemini-4-unannounced')).toBeUndefined()
  })

  it('allows native search and URL context alongside function calls', () => {
    expect(isServerToolModelEligible('gemini-4-argon', 'gemini', 'web-search')).toBe(true)
    expect(isServerToolModelEligible('gemini-4-argon', 'gemini', 'url-context')).toBe(true)
    expect(SERVER_TOOL_FUNCTION_MIXING_MODEL_IDS).toContain('gemini-4-argon')
    expect(isServerToolModelEligible('gemini-4-unannounced', 'gemini', 'web-search')).toBe(false)
  })
})
