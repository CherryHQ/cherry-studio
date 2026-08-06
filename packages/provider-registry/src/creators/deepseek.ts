import type { ReasoningEffort } from '../schemas/enums'
import { openaiCompatible } from './_api'
import { type CreatorModel, defineCreator } from './types'

/**
 * V4's own effort ladder (api-docs.deepseek.com/zh-cn/guides/thinking_mode).
 * `none` is deliberately absent: the chat API rejects it on `reasoning_effort`
 * and expresses "off" through `thinking.type: disabled` instead.
 */
const V4_EFFORTS: ReasoningEffort[] = ['low', 'high', 'xhigh', 'max']

/**
 * models.dev publishes V4 with `none` inside the ladder AND a toggle — two
 * mutually exclusive ways of saying "can be disabled". A wire that has no
 * per-endpoint contract then picks the wrong one and sends
 * `reasoning_effort: "none"`, which the API rejects (#17900). Hand-listed
 * models win over upstream, so the ladder is restated here without it.
 */
const V4_MODELS: CreatorModel[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-flash-latest', name: 'DeepSeek V4 Flash Latest' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
].map((model) => ({
  ...model,
  reasoning: { controls: [{ kind: 'effort', values: V4_EFFORTS }, { kind: 'toggle' }] }
}))

export default defineCreator({
  id: 'deepseek',
  name: 'DeepSeek',
  fetchModels: openaiCompatible('deepseek', 'DEEPSEEK_API_KEY'),
  modelsDevProviders: ['deepseek'],
  idPrefixes: ['deepseek'],
  models: V4_MODELS,
  reasoningFamilies: [
    // Same ladder for ids only the heuristics know (custom rows on unknown providers).
    { pattern: '^deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?', effort: V4_EFFORTS, toggle: true },
    // v3.x hybrid inference (thinking / non-thinking at one endpoint).
    { pattern: 'deepseek-(?:chat|v3(?:\\.\\d|-\\d))', toggle: true, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '(\\w+-)?deepseek-v3(?:\\.\\d|-\\d)(?:(\\.|-)(?!speciale$)\\w+)?$' },
    { pattern: 'deepseek-chat' },
    { pattern: 'deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?(?:-[\\w]+)*(?=$|[:/])' },
    { pattern: 'deepseek-v3\\.2-speciale' }
  ]
})
