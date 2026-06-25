import { cohereModels } from './_api'
import { defineLab } from './types'

export default defineLab({
  id: 'cohere',
  name: 'Cohere',
  fetchModels: cohereModels(),
  modelsDevProviders: ['cohere'],
  // Narrow rerank/embed prefixes to Cohere's own namespaces — bare `rerank`/`embed` would mis-claim
  // other vendors' models (Voyage `rerank-2.5`, nvidia `rerank-qa-mistral-4b`).
  idPrefixes: [
    'command',
    'c4ai',
    'aya',
    'north',
    'rerank-v',
    'rerank-english',
    'rerank-multilingual',
    'embed-v',
    'embed-english',
    'embed-multilingual'
  ],
  models: [
    // ── Command (chat) ──
    {
      id: 'command-a-plus-05-2026',
      name: 'Command A+',
      capabilities: ['function-call', 'reasoning', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 131072,
      maxOutputTokens: 65536
    },
    {
      id: 'command-a',
      name: 'Command A',
      capabilities: ['function-call'],
      contextWindow: 262144,
      maxOutputTokens: 8192
    },
    {
      id: 'command-a-03-2025',
      name: 'Command A',
      capabilities: ['function-call'],
      contextWindow: 262144,
      maxOutputTokens: 8192
    },
    {
      id: 'command-a-reasoning-08-2025',
      name: 'Command A Reasoning',
      capabilities: ['function-call', 'reasoning'],
      contextWindow: 262144,
      maxOutputTokens: 32768
    },
    {
      id: 'command-a-vision-07-2025',
      name: 'Command A Vision',
      capabilities: ['function-call', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 131072,
      maxOutputTokens: 8192
    },
    {
      id: 'command-a-translate-08-2025',
      name: 'Command A Translate',
      capabilities: ['function-call'],
      contextWindow: 8192,
      maxOutputTokens: 8192
    },
    {
      id: 'command-r7b-12-2024',
      name: 'Command R7B',
      capabilities: ['function-call'],
      contextWindow: 131072,
      maxOutputTokens: 4096
    },
    {
      id: 'command-r-08-2024',
      name: 'Command R (08-2024)',
      capabilities: ['function-call'],
      contextWindow: 131072,
      maxOutputTokens: 4096
    },
    {
      id: 'command-r-plus-08-2024',
      name: 'Command R+ (08-2024)',
      capabilities: ['function-call'],
      contextWindow: 131072,
      maxOutputTokens: 4096
    },
    {
      id: 'command-r',
      name: 'Command R',
      capabilities: ['function-call'],
      contextWindow: 131072,
      maxOutputTokens: 4096
    },
    {
      id: 'command-r-plus',
      name: 'Command R+',
      capabilities: ['function-call'],
      contextWindow: 131072,
      maxOutputTokens: 4096
    },
    { id: 'command', name: 'Command', capabilities: ['function-call'], contextWindow: 4096, maxOutputTokens: 4096 },
    {
      id: 'command-light',
      name: 'Command Light',
      capabilities: ['function-call'],
      contextWindow: 4096,
      maxOutputTokens: 4096
    },
    // ── Embed ──
    {
      id: 'embed-v4-0',
      name: 'Embed v4.0',
      inputModalities: ['text', 'image'],
      outputModalities: ['vector'],
      contextWindow: 131072
    },
    {
      id: 'embed-english-v3-0',
      name: 'Embed English v3.0',
      inputModalities: ['text', 'image'],
      outputModalities: ['vector'],
      contextWindow: 512
    },
    {
      id: 'embed-english-light-v3-0',
      name: 'Embed English Light v3.0',
      outputModalities: ['vector'],
      contextWindow: 512
    },
    {
      id: 'embed-multilingual-v3-0',
      name: 'Embed Multilingual v3.0',
      inputModalities: ['text', 'image'],
      outputModalities: ['vector'],
      contextWindow: 512
    },
    {
      id: 'embed-multilingual-light-v3-0',
      name: 'Embed Multilingual Light v3.0',
      outputModalities: ['vector'],
      contextWindow: 512
    },
    // ── Rerank ──
    { id: 'rerank-v4-pro', name: 'Rerank v4 Pro', capabilities: ['rerank'], contextWindow: 32768 },
    { id: 'rerank-v4-fast', name: 'Rerank v4 Fast', capabilities: ['rerank'], contextWindow: 32768 },
    { id: 'rerank-v3-5', name: 'Rerank v3.5', capabilities: ['rerank'], contextWindow: 4096 },
    { id: 'rerank-english-v3-0', name: 'Rerank English v3.0', capabilities: ['rerank'], contextWindow: 4096 },
    { id: 'rerank-multilingual-v3-0', name: 'Rerank Multilingual v3.0', capabilities: ['rerank'], contextWindow: 4096 },
    // ── Aya (multilingual) ──
    {
      id: 'c4ai-aya-expanse-32b',
      name: 'Aya Expanse 32B',
      capabilities: ['function-call'],
      contextWindow: 131072,
      maxOutputTokens: 4096
    },
    {
      id: 'c4ai-aya-vision-32b',
      name: 'Aya Vision 32B',
      capabilities: ['function-call', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 16384,
      maxOutputTokens: 4096
    },
    {
      id: 'c4ai-aya-expanse-8b',
      name: 'Aya Expanse 8B',
      capabilities: ['function-call'],
      contextWindow: 8192,
      maxOutputTokens: 4096
    },
    {
      id: 'c4ai-aya-vision-8b',
      name: 'Aya Vision 8B',
      capabilities: ['function-call', 'image-recognition'],
      inputModalities: ['text', 'image'],
      contextWindow: 16384,
      maxOutputTokens: 4096
    },
    {
      id: 'tiny-aya-global',
      name: 'Tiny Aya Global',
      capabilities: ['function-call'],
      contextWindow: 8192,
      maxOutputTokens: 8192
    },
    {
      id: 'tiny-aya-earth',
      name: 'Tiny Aya Earth',
      capabilities: ['function-call'],
      contextWindow: 8192,
      maxOutputTokens: 8192
    },
    {
      id: 'tiny-aya-fire',
      name: 'Tiny Aya Fire',
      capabilities: ['function-call'],
      contextWindow: 8192,
      maxOutputTokens: 8192
    },
    {
      id: 'tiny-aya-water',
      name: 'Tiny Aya Water',
      capabilities: ['function-call'],
      contextWindow: 8192,
      maxOutputTokens: 8192
    },
    // ── North (agentic code) ──
    { id: 'north-mini-code-1-0', name: 'North Mini Code 1.0', capabilities: ['function-call'], contextWindow: 131072 },
    { id: 'north-mini-code', name: 'North Mini Code', capabilities: ['function-call'], contextWindow: 131072 }
  ]
})
