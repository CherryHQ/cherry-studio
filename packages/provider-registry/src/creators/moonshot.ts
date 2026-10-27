import { fixedSamplingParameterSupport } from '../providers/parameterSupports'
import type { ReasoningEffort } from '../schemas/enums'
import { openaiCompatible } from './_api'
import { type CreatorModel, defineCreator } from './types'

const K31_EFFORTS: ReasoningEffort[] = ['low', 'high', 'max']

export default defineCreator({
  id: 'moonshot',
  name: 'Moonshot AI (Kimi)',
  fetchModels: openaiCompatible('moonshot', 'MOONSHOT_API_KEY'),
  modelsDevProviders: ['moonshotai', 'moonshotai-cn'],
  families: ['kimi'],
  idPrefixes: ['kimi', 'moonshot'],
  // https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart
  models: [
    { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', input: 2, output: 10 },
    { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed', input: 4, output: 20 }
  ].map<CreatorModel>(({ id, name, input, output }) => ({
    id,
    name,
    family: 'kimi-k3.1',
    capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition', 'structured-output'],
    inputModalities: ['text', 'image', 'video'],
    outputModalities: ['text'],
    contextWindow: 1_048_576,
    maxOutputTokens: 1_048_576,
    parameterSupport: {
      ...fixedSamplingParameterSupport,
      topK: { supported: false },
      presencePenalty: false,
      frequencyPenalty: false,
      maxTokens: true,
      stopSequences: true,
      systemMessage: true
    },
    reasoning: { controls: [{ kind: 'effort', values: K31_EFFORTS, default: 'max' }] },
    pricing: {
      input: { currency: 'USD', perMillionTokens: input },
      output: { currency: 'USD', perMillionTokens: output },
      cacheRead: { currency: 'USD', perMillionTokens: 0.2 },
      cacheWrite: { currency: 'USD', perMillionTokens: input }
    }
  })),
  reasoningFamilies: [
    { pattern: '^kimi-k3[.-]1-pro(?:-highspeed)?$', effort: K31_EFFORTS, toggle: false },
    // K2.7-code only accepts thinking type 'enabled' (platform.kimi.com
    // claude-code guide: requests without it are rejected) — always-on, the
    // explicit `toggle: false` stops the generic toggle below.
    { pattern: '^kimi-k2[.-]7-code', toggle: false },
    // K3 supports low/high/max thinking effort and can disable thinking; K3 Fast
    // exposes the same effort vocabulary but is always-on.
    { pattern: '^kimi-k3$', effort: ['low', 'high', 'max'], toggle: true },
    { pattern: '^kimi-k3-fast$', effort: ['low', 'high', 'max'] },
    // Kimi K2.5+ exposes the thinking toggle; kimi-k2-thinking is always-on.
    { pattern: '^kimi-k2[.-][5-9]\\d*', toggle: true },
    // The thinking budget is a K2.x-era knob — K3 controls depth via
    // `reasoning_effort` only (platform.kimi.com thinking-effort guide).
    { pattern: 'kimi-k2[.-][5-9]\\d*', budget: { min: 0, max: 30720 }, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '^kimi-k2-thinking(?:-turbo)?$|^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)(?:-[\\w-]+)?$' }
  ]
})
