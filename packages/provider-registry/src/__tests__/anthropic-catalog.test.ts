import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { inferReasoningControls } from '../patterns/reasoning-heuristics'
import { isServerToolModelEligible } from '../patterns/serverToolModelEligibility'
import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Claude Opus 5.5 catalog', () => {
  it('exposes the official limits, pricing and always-on adaptive thinking', () => {
    expect(loader.findModel('claude-opus-5-5')).toMatchObject({
      name: 'Claude Opus 5.5',
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 4 },
        output: { currency: 'USD', perMillionTokens: 20 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 }
      },
      parameterSupport: { temperature: { supported: false }, topP: { supported: false }, topK: { supported: false } },
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' }],
        wireDialect: 'effort'
      }
    })
  })

  it.each(['claude-opus-5-5', 'anthropic/claude-opus-5.5', 'anthropic.claude-opus-5-5'])(
    'never offers a thinking toggle for custom model %s',
    (id) => {
      expect(inferReasoningControls(id)).toEqual([
        { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }
      ])
    }
  )

  it.each(['web-search', 'url-context'] as const)('enables native %s on Anthropic', (tool) => {
    expect(isServerToolModelEligible('claude-opus-5-5', 'anthropic', tool)).toBe(true)
  })
})
