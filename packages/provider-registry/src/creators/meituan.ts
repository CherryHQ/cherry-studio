import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'meituan',
  name: 'Meituan (LongCat)',
  fetchModels: openaiCompatible('longcat', 'LONGCAT_API_KEY'),
  families: ['longcat'],
  idPrefixes: ['longcat'],
  reasoningFamilies: [
    { pattern: '^longcat-2[.-]0$', toggle: true },
    { pattern: '^longcat-2[.-]5$', toggle: true }
  ],
  models: [
    {
      id: 'longcat-2-5',
      name: 'LongCat-2.5',
      family: 'longcat',
      capabilities: ['function-call', 'reasoning', 'image-recognition', 'video-recognition'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1_048_576,
      maxOutputTokens: 262_144,
      // Pinned toggle (#23688): upstream `models.dev` advertises effort tiers
      // (none/low/medium/high) for this SKU, but the Chat and Anthropic wires
      // map every tier to the same `thinking.type: enabled`, so the tiers have
      // no distinct effect and `auto` disappears. The hand-listed toggle wins
      // over upstream ingest and preserves the documented none/auto contract.
      reasoning: { controls: [{ kind: 'toggle' }] }
    },
    {
      id: 'longcat-2-0',
      name: 'LongCat-2.0',
      description:
        'LongCat-2.0 is a high-performance agentic model with native tool calling, multi-step reasoning, a 1M-token context window, and a 128K-token maximum output.',
      family: 'longcat',
      capabilities: ['function-call', 'reasoning'],
      inputModalities: ['text'],
      outputModalities: ['text'],
      contextWindow: 1048576,
      maxOutputTokens: 131072,
      // Same toggle pin as 2.5: keep the stable none/auto vocabulary even when
      // upstream reports effort tiers for this line.
      reasoning: { controls: [{ kind: 'toggle' }] }
    }
  ]
})
