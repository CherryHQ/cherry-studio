import { defineProvider } from './types'

export default defineProvider({
  id: 'aws-bedrock',
  name: 'AWS Bedrock',
  defaultChatEndpoint: 'anthropic-messages',
  endpointConfigs: {
    'anthropic-messages': { adapterFamily: 'bedrock' }
  },
  metadata: {
    website: {
      apiKey: 'https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html',
      docs: 'https://docs.aws.amazon.com/bedrock/',
      models: 'https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html',
      official: 'https://aws.amazon.com/bedrock/'
    }
  },
  overrides: [
    {
      modelId: 'claude-fable-5',
      apiModelId: 'global.anthropic.claude-fable-5',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 10 },
        output: { currency: 'USD', perMillionTokens: 50 },
        cacheRead: { currency: 'USD', perMillionTokens: 1 },
        cacheWrite: { currency: 'USD', perMillionTokens: 12.5 }
      }
    },
    {
      modelId: 'claude-haiku-4-5',
      apiModelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 1 },
        output: { currency: 'USD', perMillionTokens: 5 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.1 },
        cacheWrite: { currency: 'USD', perMillionTokens: 1.25 }
      }
    },
    {
      modelId: 'claude-opus-4-1',
      apiModelId: 'anthropic.claude-opus-4-1-20250805-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 15 },
        output: { currency: 'USD', perMillionTokens: 75 },
        cacheRead: { currency: 'USD', perMillionTokens: 1.5 },
        cacheWrite: { currency: 'USD', perMillionTokens: 18.75 }
      }
    },
    {
      modelId: 'claude-opus-4-5',
      apiModelId: 'global.anthropic.claude-opus-4-5-20251101-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 5 },
        output: { currency: 'USD', perMillionTokens: 25 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 },
        cacheWrite: { currency: 'USD', perMillionTokens: 6.25 }
      }
    },
    {
      modelId: 'claude-opus-4-6',
      apiModelId: 'global.anthropic.claude-opus-4-6-v1',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 5 },
        output: { currency: 'USD', perMillionTokens: 25 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 },
        cacheWrite: { currency: 'USD', perMillionTokens: 6.25 }
      }
    },
    {
      modelId: 'claude-opus-4-7',
      apiModelId: 'global.anthropic.claude-opus-4-7',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 5 },
        output: { currency: 'USD', perMillionTokens: 25 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 },
        cacheWrite: { currency: 'USD', perMillionTokens: 6.25 }
      }
    },
    {
      modelId: 'claude-opus-4-8',
      apiModelId: 'global.anthropic.claude-opus-4-8',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 5 },
        output: { currency: 'USD', perMillionTokens: 25 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.5 },
        cacheWrite: { currency: 'USD', perMillionTokens: 6.25 }
      }
    },
    {
      modelId: 'claude-sonnet-4-5',
      apiModelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 3 },
        output: { currency: 'USD', perMillionTokens: 15 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.3 },
        cacheWrite: { currency: 'USD', perMillionTokens: 3.75 }
      }
    },
    {
      modelId: 'claude-sonnet-4-6',
      apiModelId: 'global.anthropic.claude-sonnet-4-6',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 3 },
        output: { currency: 'USD', perMillionTokens: 15 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.3 },
        cacheWrite: { currency: 'USD', perMillionTokens: 3.75 }
      }
    },
    {
      modelId: 'devstral-2-123b',
      apiModelId: 'mistral.devstral-2-123b',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.4 }, output: { currency: 'USD', perMillionTokens: 2 } }
    },
    {
      modelId: 'gemma-3-12b-it',
      apiModelId: 'google.gemma-3-12b-it',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.049999999999999996 },
        output: { currency: 'USD', perMillionTokens: 0.09999999999999999 }
      }
    },
    {
      modelId: 'gemma-3-27b-it',
      apiModelId: 'google.gemma-3-27b-it',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.12 },
        output: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
    {
      modelId: 'gemma-3-4b-it',
      apiModelId: 'google.gemma-3-4b-it',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.04 },
        output: { currency: 'USD', perMillionTokens: 0.08 }
      }
    },
    {
      modelId: 'glm-4-7',
      apiModelId: 'zai.glm-4.7',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.6 }, output: { currency: 'USD', perMillionTokens: 2.2 } }
    },
    {
      modelId: 'glm-4-7-flash',
      apiModelId: 'zai.glm-4.7-flash',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.07 },
        output: { currency: 'USD', perMillionTokens: 0.4 }
      }
    },
    {
      modelId: 'glm-5',
      apiModelId: 'zai.glm-5',
      pricing: { input: { currency: 'USD', perMillionTokens: 1 }, output: { currency: 'USD', perMillionTokens: 3.2 } }
    },
    {
      modelId: 'gpt-oss-120b',
      apiModelId: 'openai.gpt-oss-120b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.6 }
      }
    },
    {
      modelId: 'gpt-oss-20b',
      apiModelId: 'openai.gpt-oss-20b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.07 },
        output: { currency: 'USD', perMillionTokens: 0.3 }
      }
    },
    {
      modelId: 'gpt-oss-safeguard-120b',
      apiModelId: 'openai.gpt-oss-safeguard-120b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.6 }
      }
    },
    {
      modelId: 'gpt-oss-safeguard-20b',
      apiModelId: 'openai.gpt-oss-safeguard-20b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.07 },
        output: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
    {
      modelId: 'kimi-k2',
      apiModelId: 'moonshot.kimi-k2-thinking',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.6 }, output: { currency: 'USD', perMillionTokens: 2.5 } }
    },
    {
      modelId: 'kimi-k2-5',
      apiModelId: 'moonshotai.kimi-k2.5',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.6 }, output: { currency: 'USD', perMillionTokens: 3 } }
    },
    {
      modelId: 'llama3-1-70b-instruct',
      apiModelId: 'meta.llama3-1-70b-instruct-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.72 },
        output: { currency: 'USD', perMillionTokens: 0.72 }
      }
    },
    {
      modelId: 'llama3-1-8b-instruct',
      apiModelId: 'meta.llama3-1-8b-instruct-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.22 },
        output: { currency: 'USD', perMillionTokens: 0.22 }
      }
    },
    {
      modelId: 'llama3-3-70b-instruct',
      apiModelId: 'meta.llama3-3-70b-instruct-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.72 },
        output: { currency: 'USD', perMillionTokens: 0.72 }
      }
    },
    {
      modelId: 'llama4-maverick-17b-instruct',
      apiModelId: 'meta.llama4-maverick-17b-instruct-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.24 },
        output: { currency: 'USD', perMillionTokens: 0.97 }
      }
    },
    {
      modelId: 'llama4-scout-17b-instruct',
      apiModelId: 'meta.llama4-scout-17b-instruct-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.17 },
        output: { currency: 'USD', perMillionTokens: 0.66 }
      }
    },
    {
      modelId: 'magistral-small',
      apiModelId: 'mistral.magistral-small-2509',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.5 }, output: { currency: 'USD', perMillionTokens: 1.5 } }
    },
    {
      modelId: 'minimax-m2',
      apiModelId: 'minimax.minimax-m2',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.3 }, output: { currency: 'USD', perMillionTokens: 1.2 } }
    },
    {
      modelId: 'minimax-m2-1',
      apiModelId: 'minimax.minimax-m2.1',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.3 }, output: { currency: 'USD', perMillionTokens: 1.2 } }
    },
    {
      modelId: 'minimax-m2-5',
      apiModelId: 'minimax.minimax-m2.5',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.3 }, output: { currency: 'USD', perMillionTokens: 1.2 } }
    },
    {
      modelId: 'ministral-3-14b-instruct',
      apiModelId: 'mistral.ministral-3-14b-instruct',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.2 }, output: { currency: 'USD', perMillionTokens: 0.2 } }
    },
    {
      modelId: 'ministral-3-3b-instruct',
      apiModelId: 'mistral.ministral-3-3b-instruct',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.1 }, output: { currency: 'USD', perMillionTokens: 0.1 } }
    },
    {
      modelId: 'ministral-3-8b-instruct',
      apiModelId: 'mistral.ministral-3-8b-instruct',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.15 }
      }
    },
    {
      modelId: 'mistral-large-3-675b-instruct',
      apiModelId: 'mistral.mistral-large-3-675b-instruct',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.5 }, output: { currency: 'USD', perMillionTokens: 1.5 } }
    },
    {
      modelId: 'nemotron-nano-12b',
      apiModelId: 'nvidia.nemotron-nano-12b-v2',
      name: 'NVIDIA Nemotron Nano 12B v2 VL BF16',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.2 }, output: { currency: 'USD', perMillionTokens: 0.6 } }
    },
    {
      modelId: 'nemotron-nano-3-30b',
      apiModelId: 'nvidia.nemotron-nano-3-30b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.06 },
        output: { currency: 'USD', perMillionTokens: 0.24 }
      }
    },
    {
      modelId: 'nemotron-nano-9b',
      apiModelId: 'nvidia.nemotron-nano-9b-v2',
      name: 'NVIDIA Nemotron Nano 9B v2',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.06 },
        output: { currency: 'USD', perMillionTokens: 0.23 }
      }
    },
    {
      modelId: 'nemotron-super-3-120b',
      apiModelId: 'nvidia.nemotron-super-3-120b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.65 }
      }
    },
    {
      modelId: 'nova-2-lite',
      apiModelId: 'amazon.nova-2-lite-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.33 },
        output: { currency: 'USD', perMillionTokens: 2.75 }
      }
    },
    {
      modelId: 'nova-lite',
      apiModelId: 'amazon.nova-lite-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.06 },
        output: { currency: 'USD', perMillionTokens: 0.24 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.015 }
      }
    },
    {
      modelId: 'nova-micro',
      apiModelId: 'amazon.nova-micro-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.035 },
        output: { currency: 'USD', perMillionTokens: 0.14 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.00875 }
      }
    },
    {
      modelId: 'nova-pro',
      apiModelId: 'amazon.nova-pro-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.8 },
        output: { currency: 'USD', perMillionTokens: 3.2 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.2 }
      }
    },
    {
      modelId: 'palmyra-x4',
      apiModelId: 'writer.palmyra-x4-v1:0',
      pricing: { input: { currency: 'USD', perMillionTokens: 2.5 }, output: { currency: 'USD', perMillionTokens: 10 } }
    },
    {
      modelId: 'palmyra-x5',
      apiModelId: 'writer.palmyra-x5-v1:0',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.6 }, output: { currency: 'USD', perMillionTokens: 6 } }
    },
    {
      modelId: 'pixtral-large',
      apiModelId: 'mistral.pixtral-large-2502-v1:0',
      pricing: { input: { currency: 'USD', perMillionTokens: 2 }, output: { currency: 'USD', perMillionTokens: 6 } }
    },
    {
      modelId: 'qwen3-235b-a22b',
      apiModelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.22 },
        output: { currency: 'USD', perMillionTokens: 0.88 }
      }
    },
    {
      modelId: 'qwen3-32b',
      apiModelId: 'qwen.qwen3-32b-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.6 }
      }
    },
    {
      modelId: 'qwen3-coder-30b-a3b',
      apiModelId: 'qwen.qwen3-coder-30b-a3b-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.6 }
      }
    },
    {
      modelId: 'qwen3-coder-480b-a35b',
      apiModelId: 'qwen.qwen3-coder-480b-a35b-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.22 },
        output: { currency: 'USD', perMillionTokens: 1.8 }
      }
    },
    {
      modelId: 'qwen3-coder-next',
      apiModelId: 'qwen.qwen3-coder-next',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.22 },
        output: { currency: 'USD', perMillionTokens: 1.8 }
      }
    },
    {
      modelId: 'qwen3-next-80b-a3b',
      apiModelId: 'qwen.qwen3-next-80b-a3b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.14 },
        output: { currency: 'USD', perMillionTokens: 1.4 }
      }
    },
    {
      modelId: 'qwen3-vl-235b-a22b',
      apiModelId: 'qwen.qwen3-vl-235b-a22b',
      pricing: { input: { currency: 'USD', perMillionTokens: 0.3 }, output: { currency: 'USD', perMillionTokens: 1.5 } }
    },
    {
      modelId: 'deepseek-r1',
      apiModelId: 'deepseek.r1-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 1.35 },
        output: { currency: 'USD', perMillionTokens: 5.4 }
      }
    },
    {
      modelId: 'deepseek-v3',
      apiModelId: 'deepseek.v3-v1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.58 },
        output: { currency: 'USD', perMillionTokens: 1.68 }
      }
    },
    {
      modelId: 'deepseek-v3-2',
      apiModelId: 'deepseek.v3.2',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.62 },
        output: { currency: 'USD', perMillionTokens: 1.85 }
      }
    },
    {
      modelId: 'voxtral-mini-3b',
      apiModelId: 'mistral.voxtral-mini-3b-2507',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.04 },
        output: { currency: 'USD', perMillionTokens: 0.04 }
      }
    },
    {
      modelId: 'voxtral-small-24b',
      apiModelId: 'mistral.voxtral-small-24b-2507',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.35 }
      }
    },
    {
      modelId: 'gpt-oss-120b',
      apiModelId: 'openai.gpt-oss-120b-1:0',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.6 }
      }
    }
  ]
})
