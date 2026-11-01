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

describe('Claude Haiku 5.5 catalog', () => {
  it('exposes the official limits, tiered pricing and adaptive thinking controls', () => {
    expect(loader.findModel('claude-haiku-5-5')).toMatchObject({
      name: 'Claude Haiku 5.5',
      capabilities: expect.arrayContaining([
        'reasoning',
        'function-call',
        'image-recognition',
        'structured-output',
        'file-input'
      ]),
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.1 },
        output: { currency: 'USD', perMillionTokens: 0.5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.01 },
        cacheWrite: { currency: 'USD', perMillionTokens: 0.125 },
        inputTokenTiers: [
          {
            minInputTokens: 100001,
            input: { currency: 'USD', perMillionTokens: 0.5 },
            output: { currency: 'USD', perMillionTokens: 2.5 },
            cacheRead: { currency: 'USD', perMillionTokens: 0.05 },
            cacheWrite: { currency: 'USD', perMillionTokens: 0.625 }
          }
        ]
      },
      parameterSupport: { temperature: { supported: false }, topP: { supported: false }, topK: { supported: false } },
      reasoning: {
        controls: [
          { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' },
          { kind: 'toggle' }
        ],
        wireDialect: 'effort'
      }
    })
  })

  it.each([
    'claude-haiku-5-5',
    'anthropic/claude-haiku-5.5',
    'anthropic.claude-haiku-5-5',
    'global.anthropic.claude-haiku-5-5',
    'claude-haiku-5-5@default'
  ])('resolves %s with all five effort levels and a thinking toggle', (id) => {
    expect(loader.findModel(id)?.id).toBe('claude-haiku-5-5')
    expect(inferReasoningControls(id)).toEqual([
      { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { kind: 'toggle' }
    ])
  })

  it.each(['web-search', 'url-context'] as const)('enables native %s on Anthropic', (tool) => {
    expect(isServerToolModelEligible('claude-haiku-5-5', 'anthropic', tool)).toBe(true)
  })

  it('lists the model for Claude Code with native URL fetching', () => {
    expect(loader.getOverridesForProvider('claude-code')).toContainEqual(
      expect.objectContaining({ modelId: 'claude-haiku-5-5' })
    )
    expect(isServerToolModelEligible('claude-haiku-5-5', 'claude-code', 'url-context')).toBe(true)
  })
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
        wireDialect: 'adaptive-always'
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

describe('Claude Sonnet 5.5 catalog', () => {
  it('exposes the official capabilities, limits, pricing and adaptive thinking controls', () => {
    expect(loader.findModel('claude-sonnet-5-5')).toMatchObject({
      name: 'Claude Sonnet 5.5',
      capabilities: expect.arrayContaining([
        'reasoning',
        'function-call',
        'image-recognition',
        'structured-output',
        'file-input'
      ]),
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 2 },
        output: { currency: 'USD', perMillionTokens: 10 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 },
        cacheWrite: { currency: 'USD', perMillionTokens: 2.5 }
      },
      parameterSupport: { temperature: { supported: false }, topP: { supported: false }, topK: { supported: false } },
      reasoning: {
        controls: [
          { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'high' },
          { kind: 'toggle' }
        ],
        wireDialect: 'adaptive-between-tools'
      }
    })
  })

  it.each([
    'claude-sonnet-5-5',
    'anthropic/claude-sonnet-5.5',
    'anthropic.claude-sonnet-5-5',
    'global.anthropic.claude-sonnet-5-5',
    'claude-sonnet-5-5@default'
  ])('resolves %s with xhigh and the lowest thinking setting', (id) => {
    expect(loader.findModel(id)?.id).toBe('claude-sonnet-5-5')
    expect(inferReasoningControls(id)).toEqual([
      { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { kind: 'toggle' }
    ])
  })

  it.each(['web-search', 'url-context'] as const)('enables native %s on Anthropic', (tool) => {
    expect(isServerToolModelEligible('claude-sonnet-5-5', 'anthropic', tool)).toBe(true)
  })

  it('lists the model for Claude Code with native URL fetching', () => {
    expect(loader.getOverridesForProvider('claude-code')).toContainEqual(
      expect.objectContaining({ modelId: 'claude-sonnet-5-5' })
    )
    expect(isServerToolModelEligible('claude-sonnet-5-5', 'claude-code', 'url-context')).toBe(true)
  })
})
