import { type ProviderConfig, registerMultipleProviderConfigs } from '@cherrystudio/ai-core/provider'

type ProviderInitializationLogger = {
  warn?: (message: string) => void
  error?: (message: string, error: Error) => void
}

export const SHARED_PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    import: () => import('@openrouter/ai-sdk-provider'),
    creatorFunctionName: 'createOpenRouter',
    supportsImageGeneration: true,
    aliases: ['openrouter']
  },
  {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    import: () => import('@ai-sdk/google-vertex/edge'),
    creatorFunctionName: 'createVertex',
    supportsImageGeneration: true,
    aliases: ['vertexai']
  },
  {
    id: 'google-vertex-anthropic',
    name: 'Google Vertex AI Anthropic',
    import: () => import('@ai-sdk/google-vertex/anthropic/edge'),
    creatorFunctionName: 'createVertexAnthropic',
    supportsImageGeneration: true,
    aliases: ['vertexai-anthropic']
  },
  {
    id: 'azure-anthropic',
    name: 'Azure AI Anthropic',
    import: () => import('@ai-sdk/anthropic'),
    creatorFunctionName: 'createAnthropic',
    supportsImageGeneration: false,
    aliases: ['azure-anthropic']
  },
  {
    id: 'github-copilot-openai-compatible',
    name: 'GitHub Copilot OpenAI Compatible',
    import: () => import('@opeoginni/github-copilot-openai-compatible'),
    creatorFunctionName: 'createGitHubCopilotOpenAICompatible',
    supportsImageGeneration: false,
    aliases: ['copilot', 'github-copilot']
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    import: () => import('@ai-sdk/amazon-bedrock'),
    creatorFunctionName: 'createAmazonBedrock',
    supportsImageGeneration: true,
    aliases: ['aws-bedrock']
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    import: () => import('@ai-sdk/perplexity'),
    creatorFunctionName: 'createPerplexity',
    supportsImageGeneration: false,
    aliases: ['perplexity']
  },
  {
    id: 'mistral',
    name: 'Mistral',
    import: () => import('@ai-sdk/mistral'),
    creatorFunctionName: 'createMistral',
    supportsImageGeneration: false,
    aliases: ['mistral']
  },
  {
    id: 'huggingface',
    name: 'HuggingFace',
    import: () => import('@ai-sdk/huggingface'),
    creatorFunctionName: 'createHuggingFace',
    supportsImageGeneration: true,
    aliases: ['hf', 'hugging-face']
  },
  {
    id: 'gateway',
    name: 'Vercel AI Gateway',
    import: () => import('@ai-sdk/gateway'),
    creatorFunctionName: 'createGateway',
    supportsImageGeneration: true,
    aliases: ['ai-gateway']
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    import: () => import('@ai-sdk/cerebras'),
    creatorFunctionName: 'createCerebras',
    supportsImageGeneration: false
  },
  {
    id: 'ollama',
    name: 'Ollama',
    import: () => import('ollama-ai-provider-v2'),
    creatorFunctionName: 'createOllama',
    supportsImageGeneration: false
  }
] as const

export function initializeSharedProviders(logger?: ProviderInitializationLogger): void {
  try {
    const successCount = registerMultipleProviderConfigs(SHARED_PROVIDER_CONFIGS)
    if (successCount < SHARED_PROVIDER_CONFIGS.length) {
      logger?.warn?.('Some providers failed to register. Check previous error logs.')
    }
  } catch (error) {
    logger?.error?.('Failed to initialize shared providers', error as Error)
  }
}
