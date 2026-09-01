import { openaiCompatible } from './_api'
import { defineCreator } from './types'

// The catalog can represent one static price only. Use DeepSeek's documented
// peak ceiling so cost estimates never understate first-party billing.
const v4FlashPeakPricing = {
  cacheRead: { currency: 'USD' as const, perMillionTokens: 0.014 },
  input: { currency: 'USD' as const, perMillionTokens: 0.44 },
  output: { currency: 'USD' as const, perMillionTokens: 1.32 }
}

const v4ProPeakPricing = {
  cacheRead: { currency: 'USD' as const, perMillionTokens: 0.044 },
  input: { currency: 'USD' as const, perMillionTokens: 1.32 },
  output: { currency: 'USD' as const, perMillionTokens: 3.96 }
}

export default defineCreator({
  id: 'deepseek',
  name: 'DeepSeek',
  fetchModels: openaiCompatible('deepseek', 'DEEPSEEK_API_KEY'),
  modelsDevProviders: ['deepseek'],
  idPrefixes: ['deepseek'],
  models: [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      family: 'deepseek-flash',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      contextWindow: 1048576,
      maxOutputTokens: 393216,
      inputModalities: ['text'],
      outputModalities: ['text'],
      pricing: v4FlashPeakPricing,
      reasoning: { controls: [{ kind: 'effort', values: ['none', 'low', 'high', 'max'] }] },
      openWeights: true
    },
    {
      id: 'deepseek-v4-flash-vision-exp',
      name: 'DeepSeek V4 Flash Vision Exp',
      family: 'deepseek-flash',
      capabilities: ['function-call', 'image-recognition', 'reasoning', 'structured-output'],
      contextWindow: 1048576,
      maxOutputTokens: 393216,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      pricing: v4FlashPeakPricing,
      reasoning: { controls: [{ kind: 'effort', values: ['none', 'low', 'high', 'max'] }] },
      openWeights: true
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      family: 'deepseek-thinking',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      contextWindow: 1048576,
      maxOutputTokens: 393216,
      inputModalities: ['text'],
      outputModalities: ['text'],
      pricing: v4ProPeakPricing,
      reasoning: { controls: [{ kind: 'effort', values: ['none', 'low', 'high', 'max'] }] },
      openWeights: true
    }
  ],
  reasoningFamilies: [
    { pattern: '^deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?', effort: ['none', 'low', 'high', 'max'] },
    // v3.x hybrid inference (thinking / non-thinking at one endpoint).
    { pattern: 'deepseek-(?:chat|v3(?:\\.\\d|-\\d))', toggle: true, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '(\\w+-)?deepseek-v3(?:\\.\\d|-\\d)(?:(\\.|-)(?!speciale$)\\w+)?$' },
    { pattern: 'deepseek-chat' },
    { pattern: 'deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?(?:-[\\w]+)*(?=$|[:/])' },
    { pattern: 'deepseek-v3\\.2-speciale' }
  ]
})
