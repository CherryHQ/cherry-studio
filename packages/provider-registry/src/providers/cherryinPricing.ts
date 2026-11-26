import type { ProviderModelOffer } from './types'

type Rates = [input: number, output: number, cacheRead?: number | null, cacheWrite?: number | null]
type Route = [apiModelId: string, modelId: string, endpointTypes: NonNullable<ProviderModelOffer['endpointTypes']>]

// Published default-group rates from https://open.cherryin.ai/api/pricing, in USD per million tokens.
const fixedRates: [...Route, rates: Rates][] = [
  ['BAAI/bge-reranker-v2-m3', 'bge-reranker-v2-m3', ['jina-rerank'], [0, 0]],
  ['agent/glm-5', 'glm-5', ['anthropic-messages', 'openai-chat-completions'], [0.86, 3.1562, 0.215]],
  ['agent/glm-5.2', 'glm-5-2', ['anthropic-messages', 'openai-chat-completions'], [1.18, 4.13, 0.30000000000048]],
  ['agent/kimi-k2.5', 'kimi-k2-5', ['anthropic-messages'], [0.6, 3, 0.105]],
  [
    'agent/kimi-k2.6',
    'kimi-k2-6',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.95, 3.9499999999999, 0.1600000000004]
  ],
  [
    'agent/kimi-k2.7-code',
    'kimi-k2-7-code',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.96, 3.97999999999968, 0.19000000000032]
  ],
  ['agent/minimax-m2.5', 'minimax-m2-5', ['anthropic-messages', 'openai-chat-completions'], [0.3, 1.2, 0.03]],
  [
    'agent/minimax-m2.5-highspeed',
    'minimax-m2-5-highspeed',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.6, 2.4, 0.03]
  ],
  ['agent/minimax-m2.7', 'minimax-m2-7', ['anthropic-messages', 'openai-chat-completions'], [0.3, 1.2, 0.06]],
  [
    'agent/minimax-m2.7-highspeed',
    'minimax-m2-7-highspeed',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.6, 2.4, 0.06]
  ],
  ['agent/qwen3.5-flash', 'qwen3-5-flash', ['anthropic-messages', 'openai-chat-completions'], [0.171428, 1.71428]],
  ['agent/qwen3.5-plus', 'qwen3-5-plus', ['anthropic-messages', 'openai-chat-completions'], [0.571428, 3.428568]],
  ['agent/qwen3.6-plus', 'qwen3-6-plus', ['anthropic-messages', 'openai-chat-completions'], [0.285714, 1.714284]],
  [
    'agent/qwen3.7-max',
    'qwen3-7-max',
    ['anthropic-messages', 'openai-chat-completions'],
    [1.77, 5.30000000000022, 0.34999999999938]
  ],
  [
    'agent/qwen3.8-max',
    'qwen3-8-max',
    ['anthropic-messages', 'openai-chat-completions'],
    [1.7721, 5.3163, 0.147675, 2.215125]
  ],
  ['anthropic/claude-fable-5', 'claude-fable-5', ['anthropic-messages', 'openai-chat-completions'], [10, 50, 1, 12.5]],
  [
    'anthropic/claude-fable-5.1',
    'claude-fable-5-1',
    ['anthropic-messages', 'openai-chat-completions'],
    [10, 50, 0.25, 12.5]
  ],
  ['anthropic/claude-haiku-4.5', 'claude-haiku-4-5', ['anthropic-messages', 'openai-chat-completions'], [1, 5, 0.1]],
  ['anthropic/claude-opus-4.5', 'claude-opus-4-5', ['anthropic-messages', 'openai-chat-completions'], [5, 25, 0.5]],
  ['anthropic/claude-opus-4.6', 'claude-opus-4-6', ['anthropic-messages', 'openai-chat-completions'], [5, 25, 0.5]],
  ['anthropic/claude-opus-4.7', 'claude-opus-4-7', ['anthropic-messages', 'openai-chat-completions'], [5, 25, 0.5]],
  ['anthropic/claude-opus-4.8', 'claude-opus-4-8', ['anthropic-messages', 'openai-chat-completions'], [5, 25, 0.5]],
  ['anthropic/claude-opus-5', 'claude-opus-5', ['anthropic-messages', 'openai-chat-completions'], [5, 25, 0.5]],
  ['anthropic/claude-opus-5.5', 'claude-opus-5-5', ['anthropic-messages', 'openai-chat-completions'], [4, 20, 0.2, 5]],
  [
    'anthropic/claude-sonnet-4',
    'claude-sonnet-4',
    ['anthropic-messages', 'openai-chat-completions'],
    [6, 22.5, 0.6, 7.5]
  ],
  [
    'anthropic/claude-sonnet-4.5',
    'claude-sonnet-4-5',
    ['anthropic-messages', 'openai-chat-completions'],
    [6, 22.5, 0.6, 7.5]
  ],
  [
    'anthropic/claude-sonnet-4.6',
    'claude-sonnet-4-6',
    ['anthropic-messages', 'openai-chat-completions'],
    [3, 15, 0.3, 3.75]
  ],
  [
    'anthropic/claude-sonnet-5',
    'claude-sonnet-5',
    ['anthropic-messages', 'openai-chat-completions'],
    [2, 10, 0.2, 2.5]
  ],
  [
    'anthropic/claude-sonnet-5.5',
    'claude-sonnet-5-5',
    ['anthropic-messages', 'openai-chat-completions'],
    [2, 10, 0.2, 2.5]
  ],
  ['baai/bge-m3', 'bge-m3', ['openai-embeddings'], [0.02, 0.0004]],
  [
    'google/gemini-2.5-flash',
    'gemini-2-5-flash',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.3, 2.5, 0.03]
  ],
  [
    'google/gemini-2.5-flash-lite',
    'gemini-2-5-flash-lite',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.1, 0.4, 0.01]
  ],
  [
    'google/gemini-3-flash-preview',
    'gemini-3-flash-preview',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.5, 3, 0.05]
  ],
  [
    'google/gemini-3.1-flash-lite-preview',
    'gemini-3-1-flash-lite-preview',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.25, 1.5, 0.025]
  ],
  [
    'google/gemini-3.5-flash',
    'gemini-3-5-flash',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [1.5, 9, 0.15]
  ],
  [
    'google/gemini-3.5-flash-lite',
    'gemini-3-5-flash-lite',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.3, 2.5, 0.03]
  ],
  [
    'google/gemini-3.6-flash',
    'gemini-3-6-flash',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.75, 3.75, 0.075]
  ],
  [
    'google/gemini-3.7-flash',
    'gemini-3-7-flash',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.75, 3.75, 0.075]
  ],
  [
    'google/gemini-3.8-flash',
    'gemini-3-8-flash',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [0.75, 3.75, 0.075]
  ],
  ['google/gemini-4-argon', 'gemini-4-argon', ['google-generate-content'], [2, 10, 0.1]],
  ['google/gemini-4-carbon', 'gemini-4-carbon', ['google-generate-content'], [2, 10, 0.1]],
  ['google/gemini-4-hydrogen', 'gemini-4-hydrogen', ['google-generate-content'], [1.5, 7.5, 0.075]],
  ['minimax/minimax-m2.1', 'minimax-m2-1', ['anthropic-messages', 'openai-chat-completions'], [0.3, 1.2, 0.03]],
  ['minimax/minimax-m2.5', 'minimax-m2-5', ['openai-chat-completions'], [0.3, 1.2, 0.03]],
  [
    'minimax/minimax-m2.5-highspeed',
    'minimax-m2-5-highspeed',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.6, 2.4, 0.03]
  ],
  ['minimax/minimax-m2.7', 'minimax-m2-7', ['anthropic-messages', 'openai-chat-completions'], [0.3, 1.2, 0.06]],
  [
    'minimax/minimax-m2.7-highspeed',
    'minimax-m2-7-highspeed',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.6, 2.4, 0.06]
  ],
  [
    'minimax/minimax-m3',
    'minimax-m3',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.62, 2.48, 0.12000000000014]
  ],
  ['moonshotai/kimi-k2.5', 'kimi-k2-5', ['anthropic-messages', 'openai-chat-completions'], [0.6, 3, 0.105]],
  [
    'moonshotai/kimi-k2.6',
    'kimi-k2-6',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.95, 3.9499999999999, 0.1600000000004]
  ],
  [
    'moonshotai/kimi-k2.7-code',
    'kimi-k2-7-code',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.96, 3.97999999999968, 0.19000000000032]
  ],
  ['moonshotai/kimi-k3', 'kimi-k3', ['anthropic-messages', 'openai-chat-completions'], [3, 15, 0.3]],
  ['openai/gpt-4.1', 'gpt-4-1', ['openai-chat-completions', 'anthropic-messages'], [2, 8, 0.5]],
  ['openai/gpt-4.1-mini', 'gpt-4-1-mini', ['openai-chat-completions', 'anthropic-messages'], [0.4, 1.6, 0.1]],
  ['openai/gpt-4.1-nano', 'gpt-4-1-nano', ['openai-chat-completions', 'anthropic-messages'], [0.1, 0.4, 0.03]],
  ['openai/gpt-4o', 'gpt-4o', ['openai-chat-completions', 'anthropic-messages'], [2.5, 10, 1.25]],
  [
    'openai/gpt-4o-mini',
    'gpt-4o-mini',
    ['openai-chat-completions', 'anthropic-messages'],
    [0.15, 0.6, 0.07999999999995]
  ],
  ['openai/gpt-5', 'gpt-5', ['openai-chat-completions', 'anthropic-messages'], [1.25, 10, 0.125]],
  ['openai/gpt-5-codex', 'gpt-5-codex', ['openai-responses'], [1.75, 14, 0.175]],
  ['openai/gpt-5-mini', 'gpt-5-mini', ['openai-chat-completions', 'anthropic-messages'], [0.25, 2, 0.025]],
  ['openai/gpt-5-pro', 'gpt-5-pro', ['openai-responses'], [15, 120, 1.5]],
  ['openai/gpt-5.1', 'gpt-5-1', ['openai-responses', 'anthropic-messages'], [1.25, 10, 0.125]],
  ['openai/gpt-5.1-codex', 'gpt-5-1-codex', ['openai-responses'], [1.25, 10]],
  ['openai/gpt-5.2', 'gpt-5-2', ['openai-responses', 'anthropic-messages'], [1.75, 14, 0.175]],
  ['openai/gpt-5.2-codex', 'gpt-5-2-codex', ['openai-responses'], [1.75, 14]],
  ['openai/gpt-5.3-codex', 'gpt-5-3-codex', ['openai-responses'], [1.75, 14, 0.175]],
  ['openai/gpt-5.4', 'gpt-5-4', ['openai-responses', 'anthropic-messages'], [2.5, 15, 0.25]],
  ['openai/gpt-5.4-pro', 'gpt-5-4-pro', ['openai-responses'], [60, 270]],
  ['openai/gpt-5.5', 'gpt-5-5', ['openai-responses', 'anthropic-messages'], [5, 30, 0.5]],
  ['openai/gpt-image-1', 'gpt-image-1', ['openai-image-generation'], [8, 30, 2]],
  ['openai/o1', 'o1', ['openai-chat-completions', 'anthropic-messages'], [2, 8, 0.5]],
  ['openai/o3', 'o3', ['openai-chat-completions', 'anthropic-messages'], [2, 8, 0.5]],
  ['openai/o4-mini', 'o4-mini', ['openai-chat-completions', 'anthropic-messages'], [1.1, 4.4, 0.2799999999995]],
  ['qwen/qwen3-embedding-0.6b', 'qwen3-embedding-0-6b', ['openai-embeddings'], [0.00962, 0.00962]],
  ['qwen/qwen3-embedding-4b', 'qwen3-embedding-4b', ['openai-embeddings'], [0.01, 0.01, 0.002]],
  ['qwen/qwen3-embedding-8b', 'qwen3-embedding-8b', ['openai-embeddings'], [0.56, 0.56, 0.112]],
  ['qwen/qwen3-reranker-0.6b', 'qwen3-reranker-0-6b', ['jina-rerank'], [0.00962, 0.00962]],
  ['qwen/qwen3-reranker-4b', 'qwen3-reranker-4b', ['jina-rerank'], [0.01922, 0.01922, 0.003844]],
  ['qwen/qwen3-reranker-8b', 'qwen3-reranker-8b', ['jina-rerank'], [0.56, 0.56, 0.112]],
  ['qwen/qwen3.5-flash', 'qwen3-5-flash', ['openai-chat-completions', 'anthropic-messages'], [0.171428, 1.71428]],
  ['qwen/qwen3.5-plus', 'qwen3-5-plus', ['openai-chat-completions', 'anthropic-messages'], [0.571428, 3.428568]],
  ['qwen/qwen3.6-plus', 'qwen3-6-plus', ['anthropic-messages', 'openai-chat-completions'], [0.285714, 1.714284]],
  [
    'qwen/qwen3.7-max',
    'qwen3-7-max',
    ['anthropic-messages', 'openai-chat-completions'],
    [1.77, 5.30000000000022, 0.34999999999938]
  ],
  [
    'qwen/qwen3.8-flash',
    'qwen3-8-flash',
    ['openai-chat-completions', 'anthropic-messages'],
    [0.0738375, 0.2215125, 0.00738375, 0.092296875]
  ],
  [
    'qwen/qwen3.8-max',
    'qwen3-8-max',
    ['anthropic-messages', 'openai-chat-completions'],
    [1.7721, 5.3163, 0.147675, 2.215125]
  ],
  ['tencent/hy4', 'hy4', ['openai-chat-completions'], [0.834, 2.501000000000322, 0.04199999999982]],
  ['tencent/hy4-flash', 'hy4-flash', ['openai-chat-completions'], [0.07, 0.281, 0.003]],
  [
    'x-ai/grok-4-1-fast-non-reasoning',
    'grok-4-1-fast-non-reasoning',
    ['openai-chat-completions', 'anthropic-messages'],
    [0.2, 0.5, 0.02]
  ],
  [
    'x-ai/grok-4-1-fast-reasoning',
    'grok-4-1-fast',
    ['openai-chat-completions', 'anthropic-messages'],
    [0.2, 0.5, 0.02]
  ],
  [
    'x-ai/grok-4.3',
    'grok-4-3',
    ['openai-chat-completions', 'openai-responses', 'anthropic-messages'],
    [1.25, 2.5, 0.2]
  ],
  ['x-ai/grok-4.5', 'grok-4-5', ['openai-responses', 'anthropic-messages', 'openai-chat-completions'], [2, 6, 0.5]],
  ['x-ai/grok-4.6', 'grok-4-6', ['openai-chat-completions', 'openai-responses'], [2, 6, 0.5]],
  ['z-ai/glm-5', 'glm-5', ['openai-chat-completions', 'anthropic-messages'], [0.86, 3.1562, 0.215]],
  ['z-ai/glm-5.2', 'glm-5-2', ['anthropic-messages', 'openai-chat-completions'], [1.18, 4.13, 0.30000000000048]],
  ['z-ai/glm-5.3', 'glm-5-3', ['openai-chat-completions', 'anthropic-messages'], [1.18, 4.13, 0.30000000000048]],
  ['z-ai/glm-5.3-flash', 'glm-5-3-flash', ['anthropic-messages', 'openai-chat-completions'], [0.15, 0.5, 0.03]]
]

const tieredRates: [...Route, base: Rates, minimumInputTokens: number, upper: Rates][] = [
  [
    'agent/glm-5.1',
    'glm-5-1',
    ['openai-chat-completions', 'anthropic-messages'],
    [0.883, 3.533, 0.191],
    32001,
    [1.178, 4.122, 0.294]
  ],
  [
    'google/gemini-2.5-pro',
    'gemini-2-5-pro',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [1.25, 10, 0.125],
    200001,
    [2.5, 15, 0.25]
  ],
  [
    'google/gemini-3.1-pro-preview',
    'gemini-3-1-pro-preview',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages'],
    [2, 12, 0.2],
    200001,
    [4, 18, 0.4]
  ],
  [
    'openai/gpt-5-nano',
    'gpt-5-nano',
    ['openai-responses', 'anthropic-messages'],
    [0.2, 1.2, 0.02, 0.25],
    272001,
    [0.4, 1.8, 0.04, 0.5]
  ],
  [
    'openai/gpt-5.4-mini',
    'gpt-5-4-mini',
    ['openai-responses', 'anthropic-messages'],
    [0.2, 1.2, 0.02, 0.25],
    272001,
    [0.4, 1.8, 0.04, 0.5]
  ],
  [
    'openai/gpt-5.4-nano',
    'gpt-5-4-nano',
    ['openai-responses', 'anthropic-messages'],
    [0.2, 1.2, 0.02, 0.25],
    272001,
    [0.4, 1.8, 0.04, 0.5]
  ],
  [
    'openai/gpt-5.6-luna',
    'gpt-5-6-luna',
    ['openai-responses', 'anthropic-messages'],
    [0.2, 1.2, 0.02, 0.25],
    272001,
    [0.4, 1.8, 0.04, 0.5]
  ],
  [
    'openai/gpt-5.6-sol',
    'gpt-5-6-sol',
    ['openai-responses', 'anthropic-messages'],
    [5, 30, 0.5, 6.25],
    272001,
    [10, 45, 1, 12.5]
  ],
  [
    'openai/gpt-5.6-terra',
    'gpt-5-6-terra',
    ['openai-responses', 'anthropic-messages'],
    [2, 12, 0.2, 2.5],
    272001,
    [4, 18, 0.4, 5]
  ],
  [
    'openai/gpt-6-astra',
    'gpt-6-astra',
    ['openai-responses', 'anthropic-messages'],
    [10, 50, 1, 12.5],
    272001,
    [20, 75, 2, 25]
  ],
  [
    'openai/gpt-6-luna',
    'gpt-6-luna',
    ['openai-responses', 'openai-chat-completions', 'anthropic-messages'],
    [0.1, 0.5, 0.01, 0.125],
    272001,
    [0.2, 0.75, 0.02, 0.25]
  ],
  [
    'openai/gpt-6-sol',
    'gpt-6-sol',
    ['openai-responses', 'openai-chat-completions', 'anthropic-messages'],
    [2, 10, 0.2, 2.5],
    272001,
    [4, 15, 0.4, 5]
  ],
  [
    'openai/gpt-6.1-sol',
    'gpt-6-1-sol',
    ['openai-responses', 'openai-chat-completions'],
    [2, 10, 0.1, 2.5],
    272001,
    [4, 15, 0.2, 5]
  ],
  [
    'openai/gpt-6.1-terra',
    'gpt-6-1-terra',
    ['openai-responses', 'openai-chat-completions'],
    [1, 5, 0.05, 1.25],
    272001,
    [2, 7.5, 0.1, 2.5]
  ],
  [
    'openai/gpt-6.2-astra',
    'gpt-6-2-astra',
    ['openai-responses', 'openai-chat-completions'],
    [8.8, 44, 0.44, 11],
    272001,
    [17.6, 66, 0.88, 22]
  ],
  [
    'openai/gpt-6.2-sol',
    'gpt-6-2-sol',
    ['openai-responses', 'openai-chat-completions'],
    [2.2, 11, 0.11, 2.75],
    272001,
    [4.4, 16.5, 0.22, 5.5]
  ],
  [
    'qwen/qwen3.7-plus',
    'qwen3-7-plus',
    ['anthropic-messages', 'openai-chat-completions'],
    [0.29535, 1.1814, 0.029535, 0.3691875],
    256001,
    [0.88605, 3.54421, 0.088605, 1.1075625]
  ],
  ['x-ai/grok-4.7', 'grok-4-7', ['openai-chat-completions', 'openai-responses'], [2, 6, 0.5], 200000, [4, 12, 1]],
  [
    'z-ai/glm-5.1',
    'glm-5-1',
    ['openai-chat-completions', 'anthropic-messages'],
    [0.883, 3.533, 0.191],
    32001,
    [1.178, 4.122, 0.294]
  ]
]

// These routes use time, modality, or cache-duration pricing expressions.
const nonFlatRateRoutes: Route[] = [
  ['agent/deepseek-v4-flash', 'deepseek-v4-flash', ['openai-chat-completions', 'anthropic-messages']],
  ['agent/deepseek-v4-pro', 'deepseek-v4-pro', ['openai-chat-completions', 'anthropic-messages']],
  ['anthropic/claude-haiku-5.5', 'claude-haiku-5-5', ['anthropic-messages', 'openai-chat-completions']],
  ['deepseek-v4.1-flash', 'deepseek-v4-1-flash', ['openai-chat-completions', 'anthropic-messages']],
  ['deepseek/deepseek-flash', 'deepseek-flash', ['openai-chat-completions', 'anthropic-messages']],
  ['deepseek/deepseek-v4-flash', 'deepseek-v4-flash', ['openai-chat-completions', 'anthropic-messages']],
  [
    'deepseek/deepseek-v4-flash-vision-exp',
    'deepseek-v4-flash-vision-exp',
    ['openai-chat-completions', 'anthropic-messages']
  ],
  ['deepseek/deepseek-v4-pro', 'deepseek-v4-pro', ['openai-chat-completions', 'anthropic-messages']],
  ['deepseek/deepseek-v4.1-flash-1017', 'deepseek-v4-1-flash', ['openai-chat-completions', 'anthropic-messages']],
  [
    'google/gemini-2.5-flash-image',
    'gemini-2-5-flash-image',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  [
    'google/gemini-3-pro-image',
    'gemini-3-pro-image',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  [
    'google/gemini-3-pro-image-preview',
    'gemini-3-pro-image-preview',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  [
    'google/gemini-3.1-flash-image',
    'gemini-3-1-flash-image',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  [
    'google/gemini-3.1-flash-image-preview',
    'gemini-3-1-flash-image-preview',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  [
    'google/gemini-3.1-flash-lite',
    'gemini-3-1-flash-lite',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  [
    'google/gemini-3.1-flash-lite-image',
    'gemini-3-1-flash-lite-image',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  [
    'google/gemini-nano-banana-2.1',
    'gemini-nano-banana-2-1',
    ['google-generate-content', 'openai-chat-completions', 'anthropic-messages']
  ],
  ['moonshotai/kimi-k3.1-pro', 'kimi-k3-1-pro', ['anthropic-messages', 'openai-chat-completions']],
  ['moonshotai/kimi-k3.1-pro-highspeed', 'kimi-k3-1-pro-highspeed', ['anthropic-messages', 'openai-chat-completions']],
  ['openai/gpt-image-2', 'gpt-image-2', ['openai-image-generation']],
  ['openai/gpt-image-2.5-flare', 'gpt-image-2-5-flare', ['openai-image-generation', 'openai-image-edit']],
  ['openai/gpt-image-2.5-sunburst', 'gpt-image-2-5-sunburst', ['openai-image-generation', 'openai-image-edit']],
  ['openai/gpt-image-2.6-flare', 'gpt-image-2-6-flare', ['openai-image-generation', 'openai-image-edit']],
  ['openai/gpt-image-2.6-sunburst', 'gpt-image-2-6-sunburst', ['openai-image-generation', 'openai-image-edit']]
]

const usd = (perMillionTokens: number | null) => ({ currency: 'USD' as const, perMillionTokens })

export const unknownCherryInTokenPricing = {
  input: usd(null),
  output: usd(null),
  cacheRead: usd(null),
  cacheWrite: usd(null),
  inputTokenTiers: []
}

function tokenRates([input, output, cacheRead, cacheWrite]: Rates) {
  return {
    input: usd(input),
    output: usd(output),
    cacheRead: usd(cacheRead ?? null),
    cacheWrite: usd(cacheWrite ?? null)
  }
}

const advertisedContexts: Record<string, number> = {
  'anthropic/claude-sonnet-4': 200_000,
  'anthropic/claude-sonnet-4.5': 200_000,
  'google/gemini-3.1-flash-image-preview': 65_536,
  'google/gemini-3-pro-image-preview': 65_536,
  'x-ai/grok-4.5': 1_000_000,
  'x-ai/grok-4.7': 524_288,
  'x-ai/grok-4-1-fast-non-reasoning': 2_000_000,
  'x-ai/grok-4-1-fast-reasoning': 2_000_000
}

export const cherryInPublishedPriceOffers: ProviderModelOffer[] = [
  ...nonFlatRateRoutes.map(([apiModelId, modelId, endpointTypes]) => ({
    apiModelId,
    modelId,
    endpointTypes,
    pricing: unknownCherryInTokenPricing
  })),
  ...fixedRates.map(([apiModelId, modelId, endpointTypes, rates]) => ({
    apiModelId,
    modelId,
    endpointTypes,
    pricing: { ...tokenRates(rates), inputTokenTiers: [] }
  })),
  ...tieredRates.map(([apiModelId, modelId, endpointTypes, base, minInputTokens, upper]) => ({
    apiModelId,
    modelId,
    endpointTypes,
    pricing: { ...tokenRates(base), inputTokenTiers: [{ minInputTokens, ...tokenRates(upper) }] }
  }))
].map((offer): ProviderModelOffer => {
  const contextWindow = advertisedContexts[offer.apiModelId]
  return {
    ...offer,
    ...(contextWindow === undefined ? {} : { limits: { contextWindow } }),
    ...(offer.modelId === 'qwen3-8-max' ? { capabilities: { add: ['image-recognition', 'video-recognition'] } } : {})
  }
})
