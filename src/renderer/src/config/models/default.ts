import type { Model, SystemProviderId } from '@renderer/types'

export const glm45FlashModel: Model = {
  id: 'glm-4.5-flash',
  name: 'GLM-4.5-Flash',
  provider: 'cherryai',
  group: 'GLM-4.5'
}

export const qwen38bModel: Model = {
  id: 'Qwen/Qwen3-8B',
  name: 'Qwen3-8B',
  provider: 'cherryai',
  group: 'Qwen'
}

export const SYSTEM_MODELS: Record<SystemProviderId | 'defaultModel', Model[]> = {
  defaultModel: [
    // Default assistant model
    glm45FlashModel,
    // Default topic naming model
    qwen38bModel,
    // Default translation model
    glm45FlashModel,
    // Default quick assistant model
    glm45FlashModel
  ],
  // cherryin: [],
  vertexai: [],
  '302ai': [
    {
      id: 'deepseek-chat',
      name: 'deepseek-chat',
      provider: '302ai',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-reasoner',
      name: 'deepseek-reasoner',
      provider: '302ai',
      group: 'DeepSeek'
    },
    {
      id: 'chatgpt-4o-latest',
      name: 'chatgpt-4o-latest',
      provider: '302ai',
      group: 'OpenAI'
    },
    {
      id: 'gpt-4.1',
      name: 'gpt-4.1',
      provider: '302ai',
      group: 'OpenAI'
    },
    {
      id: 'o3',
      name: 'o3',
      provider: '302ai',
      group: 'OpenAI'
    },
    {
      id: 'o4-mini',
      name: 'o4-mini',
      provider: '302ai',
      group: 'OpenAI'
    },
    {
      id: 'qwen3-235b-a22b',
      name: 'qwen3-235b-a22b',
      provider: '302ai',
      group: 'Qwen'
    },
    {
      id: 'gemini-2.5-flash-preview-05-20',
      name: 'gemini-2.5-flash-preview-05-20',
      provider: '302ai',
      group: 'Gemini'
    },
    {
      id: 'gemini-2.5-pro-preview-06-05',
      name: 'gemini-2.5-pro-preview-06-05',
      provider: '302ai',
      group: 'Gemini'
    },
    {
      id: 'claude-sonnet-4-20250514',
      provider: '302ai',
      name: 'claude-sonnet-4-20250514',
      group: 'Anthropic'
    },
    {
      id: 'claude-opus-4-20250514',
      provider: '302ai',
      name: 'claude-opus-4-20250514',
      group: 'Anthropic'
    },
    {
      id: 'jina-clip-v2',
      name: 'jina-clip-v2',
      provider: '302ai',
      group: 'Jina AI'
    },
    {
      id: 'jina-reranker-m0',
      name: 'jina-reranker-m0',
      provider: '302ai',
      group: 'Jina AI'
    }
  ],
  ph8: [
    {
      id: 'deepseek-v3-241226',
      name: 'deepseek-v3-241226',
      provider: 'ph8',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-r1-250120',
      name: 'deepseek-r1-250120',
      provider: 'ph8',
      group: 'DeepSeek'
    }
  ],
  aihubmix: [
    {
      id: 'gpt-5',
      provider: 'aihubmix',
      name: 'gpt-5',
      group: 'OpenAI'
    },
    {
      id: 'gpt-5-mini',
      provider: 'aihubmix',
      name: 'gpt-5-mini',
      group: 'OpenAI'
    },
    {
      id: 'gpt-5-nano',
      provider: 'aihubmix',
      name: 'gpt-5-nano',
      group: 'OpenAI'
    },
    {
      id: 'gpt-5-chat-latest',
      provider: 'aihubmix',
      name: 'gpt-5-chat-latest',
      group: 'OpenAI'
    },
    {
      id: 'o3',
      provider: 'aihubmix',
      name: 'o3',
      group: 'OpenAI'
    },
    {
      id: 'o4-mini',
      provider: 'aihubmix',
      name: 'o4-mini',
      group: 'OpenAI'
    },
    {
      id: 'gpt-4.1',
      provider: 'aihubmix',
      name: 'gpt-4.1',
      group: 'OpenAI'
    },
    {
      id: 'gpt-4o',
      provider: 'aihubmix',
      name: 'gpt-4o',
      group: 'OpenAI'
    },
    {
      id: 'gpt-image-1',
      provider: 'aihubmix',
      name: 'gpt-image-1',
      group: 'OpenAI'
    },
    {
      id: 'DeepSeek-V3',
      provider: 'aihubmix',
      name: 'DeepSeek-V3',
      group: 'DeepSeek'
    },
    {
      id: 'DeepSeek-R1',
      provider: 'aihubmix',
      name: 'DeepSeek-R1',
      group: 'DeepSeek'
    },
    {
      id: 'claude-sonnet-4-20250514',
      provider: 'aihubmix',
      name: 'claude-sonnet-4-20250514',
      group: 'Claude'
    },
    {
      id: 'gemini-2.5-pro',
      provider: 'aihubmix',
      name: 'gemini-2.5-pro',
      group: 'Gemini'
    },
    {
      id: 'gemini-2.5-flash-nothink',
      provider: 'aihubmix',
      name: 'gemini-2.5-flash-nothink',
      group: 'Gemini'
    },
    {
      id: 'gemini-2.5-flash',
      provider: 'aihubmix',
      name: 'gemini-2.5-flash',
      group: 'Gemini'
    },
    {
      id: 'Qwen3-235B-A22B-Instruct-2507',
      provider: 'aihubmix',
      name: 'Qwen3-235B-A22B-Instruct-2507',
      group: 'qwen'
    },
    {
      id: 'kimi-k2-0711-preview',
      provider: 'aihubmix',
      name: 'kimi-k2-0711-preview',
      group: 'moonshot'
    },
    {
      id: 'Llama-4-Scout-17B-16E-Instruct',
      provider: 'aihubmix',
      name: 'Llama-4-Scout-17B-16E-Instruct',
      group: 'llama'
    },
    {
      id: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
      provider: 'aihubmix',
      name: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
      group: 'llama'
    }
  ],

  burncloud: [
    { id: 'claude-3-7-sonnet-20250219-thinking', provider: 'burncloud', name: 'Claude 3.7 thinking', group: 'Claude' },
    { id: 'claude-3-7-sonnet-20250219', provider: 'burncloud', name: 'Claude 3.7 Sonnet', group: 'Claude 3.7' },
    { id: 'claude-3-5-sonnet-20241022', provider: 'burncloud', name: 'Claude 3.5 Sonnet', group: 'Claude 3.5' },
    { id: 'claude-3-5-haiku-20241022', provider: 'burncloud', name: 'Claude 3.5 Haiku', group: 'Claude 3.5' },

    { id: 'gpt-4.5-preview', provider: 'burncloud', name: 'gpt-4.5-preview', group: 'gpt-4.5' },
    { id: 'gpt-4o', provider: 'burncloud', name: 'GPT-4o', group: 'GPT 4o' },
    { id: 'gpt-4o-mini', provider: 'burncloud', name: 'GPT-4o-mini', group: 'GPT 4o' },
    { id: 'o3', provider: 'burncloud', name: 'GPT-o1-mini', group: 'o1' },
    { id: 'o3-mini', provider: 'burncloud', name: 'GPT-o1-preview', group: 'o1' },
    { id: 'o1-mini', provider: 'burncloud', name: 'GPT-o1-mini', group: 'o1' },

    { id: 'gemini-2.5-pro-preview-03-25', provider: 'burncloud', name: 'Gemini 2.5 Preview', group: 'Geminit 2.5' },
    { id: 'gemini-2.5-pro-exp-03-25', provider: 'burncloud', name: 'Gemini 2.5 Pro Exp', group: 'Geminit 2.5' },
    { id: 'gemini-2.0-flash-lite', provider: 'burncloud', name: 'Gemini 2.0 Flash Lite', group: 'Geminit 2.0' },
    { id: 'gemini-2.0-flash-exp', provider: 'burncloud', name: 'Gemini 2.0 Flash Exp', group: 'Geminit 2.0' },
    { id: 'gemini-2.0-flash', provider: 'burncloud', name: 'Gemini 2.0 Flash', group: 'Geminit 2.0' },

    { id: 'deepseek-r1', name: 'DeepSeek-R1', provider: 'burncloud', group: 'deepseek-ai' },
    { id: 'deepseek-v3', name: 'DeepSeek-V3', provider: 'burncloud', group: 'deepseek-ai' }
  ],
  ollama: [],
  lmstudio: [],
  silicon: [
    {
      id: 'deepseek-ai/DeepSeek-R1',
      name: 'deepseek-ai/DeepSeek-R1',
      provider: 'silicon',
      group: 'deepseek-ai'
    },
    {
      id: 'deepseek-ai/DeepSeek-V3',
      name: 'deepseek-ai/DeepSeek-V3',
      provider: 'silicon',
      group: 'deepseek-ai'
    },
    {
      id: 'Qwen/Qwen2.5-7B-Instruct',
      provider: 'silicon',
      name: 'Qwen2.5-7B-Instruct',
      group: 'Qwen'
    },
    {
      id: 'BAAI/bge-m3',
      name: 'BAAI/bge-m3',
      provider: 'silicon',
      group: 'BAAI'
    },
    {
      id: 'Qwen/Qwen3-8B',
      name: 'Qwen/Qwen3-8B',
      provider: 'silicon',
      group: 'Qwen'
    }
  ],
  ppio: [
    {
      id: 'deepseek/deepseek-r1-0528',
      provider: 'ppio',
      name: 'DeepSeek R1-0528',
      group: 'deepseek'
    },
    {
      id: 'deepseek/deepseek-v3-0324',
      provider: 'ppio',
      name: 'DeepSeek V3-0324',
      group: 'deepseek'
    },
    {
      id: 'deepseek/deepseek-r1-turbo',
      provider: 'ppio',
      name: 'DeepSeek R1 Turbo',
      group: 'deepseek'
    },
    {
      id: 'deepseek/deepseek-v3-turbo',
      provider: 'ppio',
      name: 'DeepSeek V3 Turbo',
      group: 'deepseek'
    },
    {
      id: 'deepseek/deepseek-r1/community',
      name: 'DeepSeek: DeepSeek R1 (Community)',
      provider: 'ppio',
      group: 'deepseek'
    },
    {
      id: 'deepseek/deepseek-v3/community',
      name: 'DeepSeek: DeepSeek V3 (Community)',
      provider: 'ppio',
      group: 'deepseek'
    },
    {
      id: 'minimaxai/minimax-m1-80k',
      provider: 'ppio',
      name: 'MiniMax M1-80K',
      group: 'minimaxai'
    },
    {
      id: 'qwen/qwen3-235b-a22b-fp8',
      provider: 'ppio',
      name: 'Qwen3 235B',
      group: 'qwen'
    },
    {
      id: 'qwen/qwen3-32b-fp8',
      provider: 'ppio',
      name: 'Qwen3 32B',
      group: 'qwen'
    },
    {
      id: 'qwen/qwen3-30b-a3b-fp8',
      provider: 'ppio',
      name: 'Qwen3 30B',
      group: 'qwen'
    },
    {
      id: 'qwen/qwen2.5-vl-72b-instruct',
      provider: 'ppio',
      name: 'Qwen2.5 VL 72B',
      group: 'qwen'
    },
    {
      id: 'qwen/qwen3-embedding-8b',
      provider: 'ppio',
      name: 'Qwen3 Embedding 8B',
      group: 'qwen'
    },
    {
      id: 'qwen/qwen3-reranker-8b',
      provider: 'ppio',
      name: 'Qwen3 Reranker 8B',
      group: 'qwen'
    }
  ],
  alayanew: [],
  openai: [
    { id: 'gpt-4.5-preview', provider: 'openai', name: ' gpt-4.5-preview', group: 'gpt-4.5' },
    { id: 'gpt-4o', provider: 'openai', name: ' GPT-4o', group: 'GPT 4o' },
    { id: 'gpt-4o-mini', provider: 'openai', name: ' GPT-4o-mini', group: 'GPT 4o' },
    { id: 'o1-mini', provider: 'openai', name: ' o1-mini', group: 'o1' },
    { id: 'o1-preview', provider: 'openai', name: ' o1-preview', group: 'o1' }
  ],
  'azure-openai': [
    {
      id: 'gpt-4o',
      provider: 'azure-openai',
      name: ' GPT-4o',
      group: 'GPT 4o'
    },
    {
      id: 'gpt-4o-mini',
      provider: 'azure-openai',
      name: ' GPT-4o-mini',
      group: 'GPT 4o'
    }
  ],
  gemini: [
    {
      id: 'gemini-1.5-flash',
      provider: 'gemini',
      name: 'Gemini 1.5 Flash',
      group: 'Gemini 1.5'
    },
    {
      id: 'gemini-1.5-flash-8b',
      provider: 'gemini',
      name: 'Gemini 1.5 Flash (8B)',
      group: 'Gemini 1.5'
    },
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      provider: 'gemini',
      group: 'Gemini 1.5'
    },
    {
      id: 'gemini-2.0-flash',
      provider: 'gemini',
      name: 'Gemini 2.0 Flash',
      group: 'Gemini 2.0'
    },
    {
      id: 'gemini-2.5-flash-image-preview',
      provider: 'gemini',
      name: 'Gemini 2.5 Flash Image',
      group: 'Gemini 2.5'
    }
  ],
  anthropic: [
    {
      id: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      name: 'Claude Sonnet 4',
      group: 'Claude 4'
    },
    {
      id: 'claude-opus-4-20250514',
      provider: 'anthropic',
      name: 'Claude Opus 4',
      group: 'Claude 4'
    },
    {
      id: 'claude-3-7-sonnet-20250219',
      provider: 'anthropic',
      name: 'Claude 3.7 Sonnet',
      group: 'Claude 3.7'
    },
    {
      id: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
      name: 'Claude 3.5 Sonnet',
      group: 'Claude 3.5'
    },
    {
      id: 'claude-3-5-haiku-20241022',
      provider: 'anthropic',
      name: 'Claude 3.5 Haiku',
      group: 'Claude 3.5'
    },
    {
      id: 'claude-3-5-sonnet-20240620',
      provider: 'anthropic',
      name: 'Claude 3.5 Sonnet (Legacy)',
      group: 'Claude 3.5'
    },
    {
      id: 'claude-3-opus-20240229',
      provider: 'anthropic',
      name: 'Claude 3 Opus',
      group: 'Claude 3'
    },
    {
      id: 'claude-3-haiku-20240307',
      provider: 'anthropic',
      name: 'Claude 3 Haiku',
      group: 'Claude 3'
    }
  ],
  deepseek: [
    {
      id: 'deepseek-chat',
      provider: 'deepseek',
      name: 'DeepSeek Chat',
      group: 'DeepSeek Chat'
    },
    {
      id: 'deepseek-reasoner',
      provider: 'deepseek',
      name: 'DeepSeek Reasoner',
      group: 'DeepSeek Reasoner'
    }
  ],
  together: [
    {
      id: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
      provider: 'together',
      name: 'Llama-3.2-11B-Vision',
      group: 'Llama-3.2'
    },
    {
      id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
      provider: 'together',
      name: 'Llama-3.2-90B-Vision',
      group: 'Llama-3.2'
    },
    {
      id: 'google/gemma-2-27b-it',
      provider: 'together',
      name: 'gemma-2-27b-it',
      group: 'Gemma'
    },
    {
      id: 'google/gemma-2-9b-it',
      provider: 'together',
      name: 'gemma-2-9b-it',
      group: 'Gemma'
    }
  ],
  ocoolai: [
    {
      id: 'deepseek-chat',
      provider: 'ocoolai',
      name: 'deepseek-chat',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-reasoner',
      provider: 'ocoolai',
      name: 'deepseek-reasoner',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-ai/DeepSeek-R1',
      provider: 'ocoolai',
      name: 'deepseek-ai/DeepSeek-R1',
      group: 'DeepSeek'
    },
    {
      id: 'HiSpeed/DeepSeek-R1',
      provider: 'ocoolai',
      name: 'HiSpeed/DeepSeek-R1',
      group: 'DeepSeek'
    },
    {
      id: 'ocoolAI/DeepSeek-R1',
      provider: 'ocoolai',
      name: 'ocoolAI/DeepSeek-R1',
      group: 'DeepSeek'
    },
    {
      id: 'Azure/DeepSeek-R1',
      provider: 'ocoolai',
      name: 'Azure/DeepSeek-R1',
      group: 'DeepSeek'
    },
    {
      id: 'gpt-4o',
      provider: 'ocoolai',
      name: 'gpt-4o',
      group: 'OpenAI'
    },
    {
      id: 'gpt-4o-all',
      provider: 'ocoolai',
      name: 'gpt-4o-all',
      group: 'OpenAI'
    },
    {
      id: 'gpt-4o-mini',
      provider: 'ocoolai',
      name: 'gpt-4o-mini',
      group: 'OpenAI'
    },
    {
      id: 'gpt-4',
      provider: 'ocoolai',
      name: 'gpt-4',
      group: 'OpenAI'
    },
    {
      id: 'o1-preview',
      provider: 'ocoolai',
      name: 'o1-preview',
      group: 'OpenAI'
    },
    {
      id: 'o1-mini',
      provider: 'ocoolai',
      name: 'o1-mini',
      group: 'OpenAI'
    },
    {
      id: 'claude-3-5-sonnet-20240620',
      provider: 'ocoolai',
      name: 'claude-3-5-sonnet-20240620',
      group: 'Anthropic'
    },
    {
      id: 'claude-3-5-haiku-20241022',
      provider: 'ocoolai',
      name: 'claude-3-5-haiku-20241022',
      group: 'Anthropic'
    },
    {
      id: 'gemini-pro',
      provider: 'ocoolai',
      name: 'gemini-pro',
      group: 'Gemini'
    },
    {
      id: 'gemini-1.5-pro',
      provider: 'ocoolai',
      name: 'gemini-1.5-pro',
      group: 'Gemini'
    },
    {
      id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
      provider: 'ocoolai',
      name: 'Llama-3.2-90B-Vision-Instruct-Turbo',
      group: 'Llama-3.2'
    },
    {
      id: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
      provider: 'ocoolai',
      name: 'Llama-3.2-11B-Vision-Instruct-Turbo',
      group: 'Llama-3.2'
    },
    {
      id: 'meta-llama/Llama-3.2-3B-Vision-Instruct-Turbo',
      provider: 'ocoolai',
      name: 'Llama-3.2-3B-Vision-Instruct-Turbo',
      group: 'Llama-3.2'
    },
    {
      id: 'google/gemma-2-27b-it',
      provider: 'ocoolai',
      name: 'gemma-2-27b-it',
      group: 'Gemma'
    },
    {
      id: 'google/gemma-2-9b-it',
      provider: 'ocoolai',
      name: 'gemma-2-9b-it',
      group: 'Gemma'
    },
    {
      id: 'Doubao-embedding',
      provider: 'ocoolai',
      name: 'Doubao-embedding',
      group: 'Doubao'
    },
    {
      id: 'text-embedding-3-large',
      provider: 'ocoolai',
      name: 'text-embedding-3-large',
      group: 'Embedding'
    },
    {
      id: 'text-embedding-3-small',
      provider: 'ocoolai',
      name: 'text-embedding-3-small',
      group: 'Embedding'
    },
    {
      id: 'text-embedding-v2',
      provider: 'ocoolai',
      name: 'text-embedding-v2',
      group: 'Embedding'
    }
  ],
  github: [
    {
      id: 'gpt-4o',
      provider: 'github',
      name: 'OpenAI GPT-4o',
      group: 'OpenAI'
    }
  ],
  copilot: [
    {
      id: 'gpt-4o-mini',
      provider: 'copilot',
      name: 'OpenAI GPT-4o-mini',
      group: 'OpenAI'
    }
  ],
  yi: [
    { id: 'yi-lightning', name: 'Yi Lightning', provider: 'yi', group: 'yi-lightning', owned_by: '01.ai' },
    { id: 'yi-vision-v2', name: 'Yi Vision v2', provider: 'yi', group: 'yi-vision', owned_by: '01.ai' }
  ],
  zhipu: [
    {
      id: 'glm-4.5-flash',
      provider: 'zhipu',
      name: 'GLM-4.5-Flash',
      group: 'GLM-4.5'
    },
    {
      id: 'glm-4.5',
      provider: 'zhipu',
      name: 'GLM-4.5',
      group: 'GLM-4.5'
    },
    {
      id: 'glm-4.5-air',
      provider: 'zhipu',
      name: 'GLM-4.5-Air',
      group: 'GLM-4.5'
    },
    {
      id: 'glm-4.5-airx',
      provider: 'zhipu',
      name: 'GLM-4.5-AirX',
      group: 'GLM-4.5'
    },
    {
      id: 'glm-4.5v',
      provider: 'zhipu',
      name: 'GLM-4.5V',
      group: 'GLM-4.5V'
    },
    {
      id: 'embedding-3',
      provider: 'zhipu',
      name: 'Embedding-3',
      group: 'Embedding'
    }
  ],
  moonshot: [
    {
      id: 'moonshot-v1-auto',
      name: 'moonshot-v1-auto',
      provider: 'moonshot',
      group: 'moonshot-v1',
      owned_by: 'moonshot',
      capabilities: [{ type: 'text' }, { type: 'function_calling' }]
    },
    {
      id: 'kimi-k2-0711-preview',
      name: 'kimi-k2-0711-preview',
      provider: 'moonshot',
      group: 'kimi-k2',
      owned_by: 'moonshot',
      capabilities: [{ type: 'text' }, { type: 'function_calling' }],
      pricing: {
        input_per_million_tokens: 0.6,
        output_per_million_tokens: 2.5,
        currencySymbol: 'USD'
      }
    }
  ],
  baichuan: [
    {
      id: 'Baichuan4',
      provider: 'baichuan',
      name: 'Baichuan4',
      group: 'Baichuan4'
    },
    {
      id: 'Baichuan3-Turbo',
      provider: 'baichuan',
      name: 'Baichuan3 Turbo',
      group: 'Baichuan3'
    },
    {
      id: 'Baichuan3-Turbo-128k',
      provider: 'baichuan',
      name: 'Baichuan3 Turbo 128k',
      group: 'Baichuan3'
    }
  ],
  modelscope: [
    {
      id: 'Qwen/Qwen2.5-72B-Instruct',
      name: 'Qwen/Qwen2.5-72B-Instruct',
      provider: 'modelscope',
      group: 'Qwen'
    },
    {
      id: 'Qwen/Qwen2.5-VL-72B-Instruct',
      name: 'Qwen/Qwen2.5-VL-72B-Instruct',
      provider: 'modelscope',
      group: 'Qwen'
    },
    {
      id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      name: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      provider: 'modelscope',
      group: 'Qwen'
    },
    {
      id: 'deepseek-ai/DeepSeek-R1',
      name: 'deepseek-ai/DeepSeek-R1',
      provider: 'modelscope',
      group: 'deepseek-ai'
    },
    {
      id: 'deepseek-ai/DeepSeek-V3',
      name: 'deepseek-ai/DeepSeek-V3',
      provider: 'modelscope',
      group: 'deepseek-ai'
    }
  ],
  dashscope: [
    { id: 'qwen-vl-plus', name: 'qwen-vl-plus', provider: 'dashscope', group: 'qwen-vl', owned_by: 'system' },
    { id: 'qwen-coder-plus', name: 'qwen-coder-plus', provider: 'dashscope', group: 'qwen-coder', owned_by: 'system' },
    { id: 'qwen-flash', name: 'qwen-flash', provider: 'dashscope', group: 'qwen-flash', owned_by: 'system' },
    { id: 'qwen-plus', name: 'qwen-plus', provider: 'dashscope', group: 'qwen-plus', owned_by: 'system' },
    { id: 'qwen-max', name: 'qwen-max', provider: 'dashscope', group: 'qwen-max', owned_by: 'system' },
    { id: 'qwen3-max', name: 'qwen3-max', provider: 'dashscope', group: 'qwen-max', owned_by: 'system' }
  ],
  stepfun: [
    {
      id: 'step-1-8k',
      provider: 'stepfun',
      name: 'Step 1 8K',
      group: 'Step 1'
    },
    {
      id: 'step-1-flash',
      provider: 'stepfun',
      name: 'Step 1 Flash',
      group: 'Step 1'
    }
  ],
  doubao: [
    {
      id: 'doubao-1-5-vision-pro-32k-250115',
      provider: 'doubao',
      name: 'doubao-1.5-vision-pro',
      group: 'Doubao-1.5-vision-pro'
    },
    {
      id: 'doubao-1-5-pro-32k-250115',
      provider: 'doubao',
      name: 'doubao-1.5-pro-32k',
      group: 'Doubao-1.5-pro'
    },
    {
      id: 'doubao-1-5-pro-32k-character-250228',
      provider: 'doubao',
      name: 'doubao-1.5-pro-32k-character',
      group: 'Doubao-1.5-pro'
    },
    {
      id: 'doubao-1-5-pro-256k-250115',
      provider: 'doubao',
      name: 'Doubao-1.5-pro-256k',
      group: 'Doubao-1.5-pro'
    },
    {
      id: 'deepseek-r1-250120',
      provider: 'doubao',
      name: 'DeepSeek-R1',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-r1-distill-qwen-32b-250120',
      provider: 'doubao',
      name: 'DeepSeek-R1-Distill-Qwen-32B',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-r1-distill-qwen-7b-250120',
      provider: 'doubao',
      name: 'DeepSeek-R1-Distill-Qwen-7B',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3-250324',
      provider: 'doubao',
      name: 'DeepSeek-V3',
      group: 'DeepSeek'
    },
    {
      id: 'doubao-pro-32k-241215',
      provider: 'doubao',
      name: 'Doubao-pro-32k',
      group: 'Doubao-pro'
    },
    {
      id: 'doubao-pro-32k-functioncall-241028',
      provider: 'doubao',
      name: 'Doubao-pro-32k-functioncall-241028',
      group: 'Doubao-pro'
    },
    {
      id: 'doubao-pro-32k-character-241215',
      provider: 'doubao',
      name: 'Doubao-pro-32k-character-241215',
      group: 'Doubao-pro'
    },
    {
      id: 'doubao-pro-256k-241115',
      provider: 'doubao',
      name: 'Doubao-pro-256k',
      group: 'Doubao-pro'
    },
    {
      id: 'doubao-lite-4k-character-240828',
      provider: 'doubao',
      name: 'Doubao-lite-4k-character-240828',
      group: 'Doubao-lite'
    },
    {
      id: 'doubao-lite-32k-240828',
      provider: 'doubao',
      name: 'Doubao-lite-32k',
      group: 'Doubao-lite'
    },
    {
      id: 'doubao-lite-32k-character-241015',
      provider: 'doubao',
      name: 'Doubao-lite-32k-character-241015',
      group: 'Doubao-lite'
    },
    {
      id: 'doubao-lite-128k-240828',
      provider: 'doubao',
      name: 'Doubao-lite-128k',
      group: 'Doubao-lite'
    },
    {
      id: 'doubao-1-5-lite-32k-250115',
      provider: 'doubao',
      name: 'Doubao-1.5-lite-32k',
      group: 'Doubao-lite'
    },
    {
      id: 'doubao-embedding-large-text-240915',
      provider: 'doubao',
      name: 'Doubao-embedding-large',
      group: 'Doubao-embedding'
    },
    {
      id: 'doubao-embedding-text-240715',
      provider: 'doubao',
      name: 'Doubao-embedding',
      group: 'Doubao-embedding'
    },
    {
      id: 'doubao-embedding-vision-241215',
      provider: 'doubao',
      name: 'Doubao-embedding-vision',
      group: 'Doubao-embedding'
    },
    {
      id: 'doubao-vision-lite-32k-241015',
      provider: 'doubao',
      name: 'Doubao-vision-lite-32k',
      group: 'Doubao-vision-lite-32k'
    }
  ],
  minimax: [
    {
      id: 'abab6.5s-chat',
      provider: 'minimax',
      name: 'abab6.5s',
      group: 'abab6'
    },
    {
      id: 'abab6.5g-chat',
      provider: 'minimax',
      name: 'abab6.5g',
      group: 'abab6'
    },
    {
      id: 'abab6.5t-chat',
      provider: 'minimax',
      name: 'abab6.5t',
      group: 'abab6'
    },
    {
      id: 'abab5.5s-chat',
      provider: 'minimax',
      name: 'abab5.5s',
      group: 'abab5'
    },
    {
      id: 'minimax-text-01',
      provider: 'minimax',
      name: 'minimax-01',
      group: 'minimax-01'
    }
  ],
  hyperbolic: [
    {
      id: 'Qwen/Qwen2-VL-72B-Instruct',
      provider: 'hyperbolic',
      name: 'Qwen2-VL-72B-Instruct',
      group: 'Qwen2-VL'
    },
    {
      id: 'Qwen/Qwen2-VL-7B-Instruct',
      provider: 'hyperbolic',
      name: 'Qwen2-VL-7B-Instruct',
      group: 'Qwen2-VL'
    },
    {
      id: 'mistralai/Pixtral-12B-2409',
      provider: 'hyperbolic',
      name: 'Pixtral-12B-2409',
      group: 'Pixtral'
    },
    {
      id: 'meta-llama/Meta-Llama-3.1-405B',
      provider: 'hyperbolic',
      name: 'Meta-Llama-3.1-405B',
      group: 'Meta-Llama-3.1'
    }
  ],
  grok: [
    {
      id: 'grok-4',
      provider: 'grok',
      name: 'Grok 4',
      group: 'Grok'
    },
    {
      id: 'grok-3',
      provider: 'grok',
      name: 'Grok 3',
      group: 'Grok'
    },
    {
      id: 'grok-3-fast',
      provider: 'grok',
      name: 'Grok 3 Fast',
      group: 'Grok'
    },
    {
      id: 'grok-3-mini',
      provider: 'grok',
      name: 'Grok 3 Mini',
      group: 'Grok'
    },
    {
      id: 'grok-3-mini-fast',
      provider: 'grok',
      name: 'Grok 3 Mini Fast',
      group: 'Grok'
    },
    {
      id: 'grok-2-vision-1212',
      provider: 'grok',
      name: 'Grok 2 Vision 1212',
      group: 'Grok'
    },
    {
      id: 'grok-2-1212',
      provider: 'grok',
      name: 'Grok 2 1212',
      group: 'Grok'
    }
  ],
  mistral: [
    {
      id: 'pixtral-12b-2409',
      provider: 'mistral',
      name: 'Pixtral 12B [Free]',
      group: 'Pixtral'
    },
    {
      id: 'pixtral-large-latest',
      provider: 'mistral',
      name: 'Pixtral Large',
      group: 'Pixtral'
    },
    {
      id: 'ministral-3b-latest',
      provider: 'mistral',
      name: 'Mistral 3B [Free]',
      group: 'Mistral Mini'
    },
    {
      id: 'ministral-8b-latest',
      provider: 'mistral',
      name: 'Mistral 8B [Free]',
      group: 'Mistral Mini'
    },
    {
      id: 'codestral-latest',
      provider: 'mistral',
      name: 'Mistral Codestral',
      group: 'Mistral Code'
    },
    {
      id: 'mistral-large-latest',
      provider: 'mistral',
      name: 'Mistral Large',
      group: 'Mistral Chat'
    },
    {
      id: 'mistral-small-latest',
      provider: 'mistral',
      name: 'Mistral Small',
      group: 'Mistral Chat'
    },
    {
      id: 'open-mistral-nemo',
      provider: 'mistral',
      name: 'Mistral Nemo',
      group: 'Mistral Chat'
    },
    {
      id: 'mistral-embed',
      provider: 'mistral',
      name: 'Mistral Embedding',
      group: 'Mistral Embed'
    }
  ],
  jina: [
    {
      id: 'jina-clip-v1',
      provider: 'jina',
      name: 'jina-clip-v1',
      group: 'Jina Clip'
    },
    {
      id: 'jina-clip-v2',
      provider: 'jina',
      name: 'jina-clip-v2',
      group: 'Jina Clip'
    },
    {
      id: 'jina-embeddings-v2-base-en',
      provider: 'jina',
      name: 'jina-embeddings-v2-base-en',
      group: 'Jina Embeddings V2'
    },
    {
      id: 'jina-embeddings-v2-base-es',
      provider: 'jina',
      name: 'jina-embeddings-v2-base-es',
      group: 'Jina Embeddings V2'
    },
    {
      id: 'jina-embeddings-v2-base-de',
      provider: 'jina',
      name: 'jina-embeddings-v2-base-de',
      group: 'Jina Embeddings V2'
    },
    {
      id: 'jina-embeddings-v2-base-zh',
      provider: 'jina',
      name: 'jina-embeddings-v2-base-zh',
      group: 'Jina Embeddings V2'
    },
    {
      id: 'jina-embeddings-v2-base-code',
      provider: 'jina',
      name: 'jina-embeddings-v2-base-code',
      group: 'Jina Embeddings V2'
    },
    {
      id: 'jina-embeddings-v3',
      provider: 'jina',
      name: 'jina-embeddings-v3',
      group: 'Jina Embeddings V3'
    }
  ],
  fireworks: [
    {
      id: 'accounts/fireworks/models/mythomax-l2-13b',
      provider: 'fireworks',
      name: 'mythomax-l2-13b',
      group: 'Gryphe'
    },
    {
      id: 'accounts/fireworks/models/llama-v3-70b-instruct',
      provider: 'fireworks',
      name: 'Llama-3-70B-Instruct',
      group: 'Llama3'
    }
  ],
  hunyuan: [
    {
      id: 'hunyuan-pro',
      provider: 'hunyuan',
      name: 'hunyuan-pro',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-standard',
      provider: 'hunyuan',
      name: 'hunyuan-standard',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-lite',
      provider: 'hunyuan',
      name: 'hunyuan-lite',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-standard-256k',
      provider: 'hunyuan',
      name: 'hunyuan-standard-256k',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-vision',
      provider: 'hunyuan',
      name: 'hunyuan-vision',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-code',
      provider: 'hunyuan',
      name: 'hunyuan-code',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-role',
      provider: 'hunyuan',
      name: 'hunyuan-role',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-turbo',
      provider: 'hunyuan',
      name: 'hunyuan-turbo',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-turbos-latest',
      provider: 'hunyuan',
      name: 'hunyuan-turbos-latest',
      group: 'Hunyuan'
    },
    {
      id: 'hunyuan-embedding',
      provider: 'hunyuan',
      name: 'hunyuan-embedding',
      group: 'Embedding'
    }
  ],
  nvidia: [
    {
      id: '01-ai/yi-large',
      provider: 'nvidia',
      name: 'yi-large',
      group: 'Yi'
    },
    {
      id: 'meta/llama-3.1-405b-instruct',
      provider: 'nvidia',
      name: 'llama-3.1-405b-instruct',
      group: 'llama-3.1'
    }
  ],
  openrouter: [
    {
      id: 'google/gemini-2.5-flash-image-preview',
      provider: 'openrouter',
      name: 'Google: Gemini 2.5 Flash Image',
      group: 'google'
    },
    {
      id: 'google/gemini-2.5-flash-preview',
      provider: 'openrouter',
      name: 'Google: Gemini 2.5 Flash Preview',
      group: 'google'
    },
    {
      id: 'qwen/qwen-2.5-7b-instruct:free',
      provider: 'openrouter',
      name: 'Qwen: Qwen-2.5-7B Instruct',
      group: 'qwen'
    },
    {
      id: 'deepseek/deepseek-chat',
      provider: 'openrouter',
      name: 'DeepSeek: V3',
      group: 'deepseek'
    },
    {
      id: 'mistralai/mistral-7b-instruct:free',
      provider: 'openrouter',
      name: 'Mistral: Mistral 7B Instruct',
      group: 'mistralai'
    }
  ],
  groq: [
    {
      id: 'llama3-8b-8192',
      provider: 'groq',
      name: 'LLaMA3 8B',
      group: 'Llama3'
    },
    {
      id: 'llama3-70b-8192',
      provider: 'groq',
      name: 'LLaMA3 70B',
      group: 'Llama3'
    },
    {
      id: 'mistral-saba-24b',
      provider: 'groq',
      name: 'Mistral Saba 24B',
      group: 'Mistral'
    },
    {
      id: 'gemma-9b-it',
      provider: 'groq',
      name: 'Gemma 9B',
      group: 'Gemma'
    }
  ],
  'baidu-cloud': [
    {
      id: 'deepseek-r1',
      provider: 'baidu-cloud',
      name: 'DeepSeek R1',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3',
      provider: 'baidu-cloud',
      name: 'DeepSeek V3',
      group: 'DeepSeek'
    },
    {
      id: 'ernie-4.0-8k-latest',
      provider: 'baidu-cloud',
      name: 'ERNIE-4.0',
      group: 'ERNIE'
    },
    {
      id: 'ernie-4.0-turbo-8k-latest',
      provider: 'baidu-cloud',
      name: 'ERNIE 4.0 Trubo',
      group: 'ERNIE'
    },
    {
      id: 'ernie-speed-8k',
      provider: 'baidu-cloud',
      name: 'ERNIE Speed',
      group: 'ERNIE'
    },
    {
      id: 'ernie-lite-8k',
      provider: 'baidu-cloud',
      name: 'ERNIE Lite',
      group: 'ERNIE'
    },
    {
      id: 'bge-large-zh',
      provider: 'baidu-cloud',
      name: 'BGE Large ZH',
      group: 'Embedding'
    },
    {
      id: 'bge-large-en',
      provider: 'baidu-cloud',
      name: 'BGE Large EN',
      group: 'Embedding'
    }
  ],
  dmxapi: [
    {
      id: 'Qwen/Qwen2.5-7B-Instruct',
      provider: 'dmxapi',
      name: 'Qwen/Qwen2.5-7B-Instruct',
      group: '免费模型'
    },
    {
      id: 'ERNIE-Speed-128K',
      provider: 'dmxapi',
      name: 'ERNIE-Speed-128K',
      group: '免费模型'
    },
    {
      id: 'gpt-4o',
      provider: 'dmxapi',
      name: 'gpt-4o',
      group: 'OpenAI'
    },
    {
      id: 'gpt-4o-mini',
      provider: 'dmxapi',
      name: 'gpt-4o-mini',
      group: 'OpenAI'
    },
    {
      id: 'DMXAPI-DeepSeek-R1',
      provider: 'dmxapi',
      name: 'DMXAPI-DeepSeek-R1',
      group: 'DeepSeek'
    },
    {
      id: 'DMXAPI-DeepSeek-V3',
      provider: 'dmxapi',
      name: 'DMXAPI-DeepSeek-V3',
      group: 'DeepSeek'
    },
    {
      id: 'claude-3-5-sonnet-20241022',
      provider: 'dmxapi',
      name: 'claude-3-5-sonnet-20241022',
      group: 'Claude'
    },
    {
      id: 'gemini-2.0-flash',
      provider: 'dmxapi',
      name: 'gemini-2.0-flash',
      group: 'Gemini'
    }
  ],
  perplexity: [
    {
      id: 'sonar-reasoning-pro',
      provider: 'perplexity',
      name: 'sonar-reasoning-pro',
      group: 'Sonar'
    },
    {
      id: 'sonar-reasoning',
      provider: 'perplexity',
      name: 'sonar-reasoning',
      group: 'Sonar'
    },
    {
      id: 'sonar-pro',
      provider: 'perplexity',
      name: 'sonar-pro',
      group: 'Sonar'
    },
    {
      id: 'sonar',
      provider: 'perplexity',
      name: 'sonar',
      group: 'Sonar'
    },
    {
      id: 'sonar-deep-research',
      provider: 'perplexity',
      name: 'sonar-deep-research',
      group: 'Sonar'
    }
  ],
  infini: [
    {
      id: 'deepseek-r1',
      provider: 'infini',
      name: 'deepseek-r1',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-r1-distill-qwen-32b',
      provider: 'infini',
      name: 'deepseek-r1-distill-qwen-32b',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3',
      provider: 'infini',
      name: 'deepseek-v3',
      group: 'DeepSeek'
    },
    {
      id: 'qwen2.5-72b-instruct',
      provider: 'infini',
      name: 'qwen2.5-72b-instruct',
      group: 'Qwen'
    },
    {
      id: 'qwen2.5-32b-instruct',
      provider: 'infini',
      name: 'qwen2.5-32b-instruct',
      group: 'Qwen'
    },
    {
      id: 'qwen2.5-14b-instruct',
      provider: 'infini',
      name: 'qwen2.5-14b-instruct',
      group: 'Qwen'
    },
    {
      id: 'qwen2.5-7b-instruct',
      provider: 'infini',
      name: 'qwen2.5-7b-instruct',
      group: 'Qwen'
    },
    {
      id: 'qwen2-72b-instruct',
      provider: 'infini',
      name: 'qwen2-72b-instruct',
      group: 'Qwen'
    },
    {
      id: 'qwq-32b-preview',
      provider: 'infini',
      name: 'qwq-32b-preview',
      group: 'Qwen'
    },
    {
      id: 'qwen2.5-coder-32b-instruct',
      provider: 'infini',
      name: 'qwen2.5-coder-32b-instruct',
      group: 'Qwen'
    },
    {
      id: 'llama-3.3-70b-instruct',
      provider: 'infini',
      name: 'llama-3.3-70b-instruct',
      group: 'Llama'
    },
    {
      id: 'bge-m3',
      provider: 'infini',
      name: 'bge-m3',
      group: 'BAAI'
    },
    {
      id: 'gemma-2-27b-it',
      provider: 'infini',
      name: 'gemma-2-27b-it',
      group: 'Gemma'
    },
    {
      id: 'jina-embeddings-v2-base-zh',
      provider: 'infini',
      name: 'jina-embeddings-v2-base-zh',
      group: 'Jina'
    },
    {
      id: 'jina-embeddings-v2-base-code',
      provider: 'infini',
      name: 'jina-embeddings-v2-base-code',
      group: 'Jina'
    }
  ],
  xirang: [],
  'tencent-cloud-ti': [
    {
      id: 'deepseek-r1',
      provider: 'tencent-cloud-ti',
      name: 'DeepSeek R1',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3',
      provider: 'tencent-cloud-ti',
      name: 'DeepSeek V3',
      group: 'DeepSeek'
    }
  ],
  gpustack: [],
  voyageai: [
    {
      id: 'voyage-3-large',
      provider: 'voyageai',
      name: 'voyage-3-large',
      group: 'Voyage Embeddings V3'
    },
    {
      id: 'voyage-3',
      provider: 'voyageai',
      name: 'voyage-3',
      group: 'Voyage Embeddings V3'
    },
    {
      id: 'voyage-3-lite',
      provider: 'voyageai',
      name: 'voyage-3-lite',
      group: 'Voyage Embeddings V3'
    },
    {
      id: 'voyage-code-3',
      provider: 'voyageai',
      name: 'voyage-code-3',
      group: 'Voyage Embeddings V3'
    },
    {
      id: 'voyage-finance-3',
      provider: 'voyageai',
      name: 'voyage-finance-3',
      group: 'Voyage Embeddings V2'
    },
    {
      id: 'voyage-law-2',
      provider: 'voyageai',
      name: 'voyage-law-2',
      group: 'Voyage Embeddings V2'
    },
    {
      id: 'voyage-code-2',
      provider: 'voyageai',
      name: 'voyage-code-2',
      group: 'Voyage Embeddings V2'
    },
    {
      id: 'rerank-2',
      provider: 'voyageai',
      name: 'rerank-2',
      group: 'Voyage Rerank V2'
    },
    {
      id: 'rerank-2-lite',
      provider: 'voyageai',
      name: 'rerank-2-lite',
      group: 'Voyage Rerank V2'
    }
  ],
  qiniu: [
    {
      id: 'deepseek-r1',
      provider: 'qiniu',
      name: 'DeepSeek R1',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-r1-search',
      provider: 'qiniu',
      name: 'DeepSeek R1 Search',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-r1-32b',
      provider: 'qiniu',
      name: 'DeepSeek R1 32B',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3',
      provider: 'qiniu',
      name: 'DeepSeek V3',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3-search',
      provider: 'qiniu',
      name: 'DeepSeek V3 Search',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3-tool',
      provider: 'qiniu',
      name: 'DeepSeek V3 Tool',
      group: 'DeepSeek'
    },
    {
      id: 'qwq-32b',
      provider: 'qiniu',
      name: 'QWQ 32B',
      group: 'Qwen'
    },
    {
      id: 'qwen2.5-72b-instruct',
      provider: 'qiniu',
      name: 'Qwen2.5 72B Instruct',
      group: 'Qwen'
    }
  ],
  tokenflux: [
    {
      id: 'gpt-4.1',
      provider: 'tokenflux',
      name: 'GPT-4.1',
      group: 'GPT-4.1'
    },
    {
      id: 'gpt-4.1-mini',
      provider: 'tokenflux',
      name: 'GPT-4.1 Mini',
      group: 'GPT-4.1'
    },
    {
      id: 'claude-sonnet-4',
      provider: 'tokenflux',
      name: 'Claude Sonnet 4',
      group: 'Claude'
    },
    {
      id: 'claude-3-7-sonnet',
      provider: 'tokenflux',
      name: 'Claude 3.7 Sonnet',
      group: 'Claude'
    },
    {
      id: 'gemini-2.5-pro',
      provider: 'tokenflux',
      name: 'Gemini 2.5 Pro',
      group: 'Gemini'
    },
    {
      id: 'gemini-2.5-flash',
      provider: 'tokenflux',
      name: 'Gemini 2.5 Flash',
      group: 'Gemini'
    },
    {
      id: 'deepseek-r1',
      provider: 'tokenflux',
      name: 'DeepSeek R1',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-v3',
      provider: 'tokenflux',
      name: 'DeepSeek V3',
      group: 'DeepSeek'
    },
    {
      id: 'qwen-max',
      provider: 'tokenflux',
      name: 'Qwen Max',
      group: 'Qwen'
    },
    {
      id: 'qwen-plus',
      provider: 'tokenflux',
      name: 'Qwen Plus',
      group: 'Qwen'
    }
  ],
  cephalon: [
    {
      id: 'DeepSeek-R1',
      provider: 'cephalon',
      name: 'DeepSeek-R1满血版',
      group: 'DeepSeek'
    }
  ],
  lanyun: [
    {
      id: '/maas/deepseek-ai/DeepSeek-R1-0528',
      name: 'deepseek-ai/DeepSeek-R1',
      provider: 'lanyun',
      group: 'deepseek-ai'
    },
    {
      id: '/maas/deepseek-ai/DeepSeek-V3-0324',
      name: 'deepseek-ai/DeepSeek-V3',
      provider: 'lanyun',
      group: 'deepseek-ai'
    },
    {
      id: '/maas/qwen/Qwen2.5-72B-Instruct',
      provider: 'lanyun',
      name: 'Qwen2.5-72B-Instruct',
      group: 'Qwen'
    },
    {
      id: '/maas/qwen/Qwen3-235B-A22B',
      name: 'Qwen/Qwen3-235B',
      provider: 'lanyun',
      group: 'Qwen'
    },
    {
      id: '/maas/minimax/MiniMax-M1-80k',
      name: 'MiniMax-M1-80k',
      provider: 'lanyun',
      group: 'MiniMax'
    },
    {
      id: '/maas/google/Gemma3-27B',
      name: 'Gemma3-27B',
      provider: 'lanyun',
      group: 'google'
    }
  ],
  'new-api': [],
  'aws-bedrock': [],
  poe: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'poe',
      group: 'poe'
    }
  ],
  aionly: [
    {
      id: 'claude-opus-4.1',
      name: 'claude-opus-4.1',
      provider: 'aionly',
      group: 'claude'
    },
    {
      id: 'claude-sonnet4',
      name: 'claude-sonnet4',
      provider: 'aionly',
      group: 'claude'
    },
    {
      id: 'claude-3.5-sonnet-v2',
      name: 'claude-3.5-sonnet-v2',
      provider: 'aionly',
      group: 'claude'
    },
    {
      id: 'gpt-4.1',
      name: 'gpt-4.1',
      provider: 'aionly',
      group: 'gpt'
    },
    {
      id: 'gemini-2.5-flash',
      name: 'gemini-2.5-flash',
      provider: 'aionly',
      group: 'gemini'
    }
  ],
  longcat: [
    {
      id: 'LongCat-Flash-Chat',
      name: 'LongCat Flash Chat',
      provider: 'longcat',
      group: 'LongCat'
    },
    {
      id: 'LongCat-Flash-Thinking',
      name: 'LongCat Flash Thinking',
      provider: 'longcat',
      group: 'LongCat'
    }
  ]
}
