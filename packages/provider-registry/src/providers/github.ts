import { openaiCompatible } from './types'

/** GitHub Models is free — every row overrides the base model's vendor pricing with zero. */
const FREE = {
  input: { currency: 'USD' as const, perMillionTokens: 0 },
  output: { currency: 'USD' as const, perMillionTokens: 0 }
}

// GitHub serves every model under a vendor namespace (`cohere/cohere-command-r`), so `modelId` is
// that served id and generation derives the canonical key + `apiModelId`. Hand-listed from the last
// models.dev snapshot: upstream dropped its `github-models` provider (2026-08), and without this map
// the canonical id would go on the wire and 404.
const servedModels = [
  'ai21-labs/ai21-jamba-1.5-large',
  'ai21-labs/ai21-jamba-1.5-mini',
  'cohere/cohere-command-a',
  'cohere/cohere-command-r',
  'cohere/cohere-command-r-08-2024',
  'cohere/cohere-command-r-plus',
  'cohere/cohere-command-r-plus-08-2024',
  'deepseek/deepseek-r1-0528',
  'deepseek/deepseek-v3-0324',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-4-maverick-17b-128e-instruct-fp8',
  'meta/meta-llama-3.1-70b-instruct',
  'meta/meta-llama-3.1-8b-instruct',
  'microsoft/phi-4',
  'microsoft/phi-4-mini-instruct',
  'microsoft/phi-4-multimodal-instruct',
  'mistral-ai/codestral-2501',
  'mistral-ai/ministral-3b',
  'mistral-ai/mistral-large-2411',
  'mistral-ai/mistral-medium-2505',
  'mistral-ai/mistral-nemo',
  'mistral-ai/mistral-small-2503',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/o1',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  'xai/grok-3',
  'xai/grok-3-mini'
]

/** Vendor-exclusive SKUs with no base catalog row — they carry their own display name. */
const standaloneModels = [
  { modelId: 'core42/jais-30b-chat', name: 'JAIS 30b Chat' },
  { modelId: 'meta/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B 16E Instruct' },
  { modelId: 'meta/meta-llama-3-70b-instruct', name: 'Meta-Llama-3-70B-Instruct' },
  { modelId: 'meta/meta-llama-3-8b-instruct', name: 'Meta-Llama-3-8B-Instruct' },
  { modelId: 'meta/meta-llama-3.1-405b-instruct', name: 'Meta-Llama-3.1-405B-Instruct' },
  { modelId: 'microsoft/mai-ds-r1', name: 'MAI-DS-R1' },
  { modelId: 'microsoft/phi-3-medium-128k-instruct', name: 'Phi-3-medium instruct (128k)' },
  { modelId: 'microsoft/phi-3-medium-4k-instruct', name: 'Phi-3-medium instruct (4k)' },
  { modelId: 'microsoft/phi-3-mini-128k-instruct', name: 'Phi-3-mini instruct (128k)' },
  { modelId: 'microsoft/phi-3-mini-4k-instruct', name: 'Phi-3-mini instruct (4k)' },
  { modelId: 'microsoft/phi-3-small-128k-instruct', name: 'Phi-3-small instruct (128k)' },
  { modelId: 'microsoft/phi-3-small-8k-instruct', name: 'Phi-3-small instruct (8k)' },
  { modelId: 'microsoft/phi-3.5-mini-instruct', name: 'Phi-3.5-mini instruct (128k)' },
  { modelId: 'microsoft/phi-3.5-moe-instruct', name: 'Phi-3.5-MoE instruct (128k)' },
  { modelId: 'microsoft/phi-3.5-vision-instruct', name: 'Phi-3.5-vision instruct (128k)' },
  { modelId: 'microsoft/phi-4-mini-reasoning', name: 'Phi-4-mini-reasoning' },
  { modelId: 'openai/o1-mini', name: 'OpenAI o1-mini' },
  { modelId: 'openai/o1-preview', name: 'OpenAI o1-preview' }
]

export default openaiCompatible({
  id: 'github',
  name: 'Github Models',
  baseUrl: 'https://models.github.ai/inference',
  website: {
    apiKey: 'https://github.com/settings/tokens',
    docs: 'https://docs.github.com/en/github-models',
    models: 'https://github.com/marketplace/models',
    official: 'https://github.com/marketplace/models'
  },
  overrides: [
    ...servedModels.map((modelId) => ({ modelId, pricing: FREE })),
    ...standaloneModels.map((row) => ({ ...row, pricing: FREE }))
  ]
})
