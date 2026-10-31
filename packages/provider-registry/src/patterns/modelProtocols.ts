import { getModelRequestPolicies } from './requestPolicyLookup'

export function requiresThoughtSignatures(modelId: string, providerId?: string): boolean {
  return getModelRequestPolicies(modelId, providerId)?.messages?.thoughtSignatures === true
}

/** Unknown hosts retain the existing dynamic-tool compatibility default. */
export function supportsDynamicToolDeclarations(modelId: string, providerId?: string): boolean {
  return getModelRequestPolicies(modelId, providerId)?.messages?.dynamicToolDeclarations !== false
}

export function supportsThinkingPrompt(modelId: string, providerId?: string): boolean {
  return getModelRequestPolicies(modelId, providerId)?.messages?.thinkingPrompt === true
}

export function usesTranslationMessages(modelId: string, providerId?: string): boolean {
  return getModelRequestPolicies(modelId, providerId)?.messages?.translation === true
}

export function usesChatSearchOptions(modelId: string, providerId?: string): boolean {
  return getModelRequestPolicies(modelId, providerId)?.messages?.search === 'chat-options'
}

export function usesDeepResearchSearchTool(modelId: string, providerId: string): boolean {
  return (
    ['openai', 'openai-chat'].includes(providerId) &&
    getModelRequestPolicies(modelId, providerId)?.messages?.search === 'deep-research'
  )
}

/** The adapter owns header serialization; the catalog owns model applicability. */
export function getAnthropicBetaPolicy(modelId: string, host: 'direct' | 'vertex' | 'bedrock', providerId?: string) {
  const policy = getModelRequestPolicies(modelId, providerId)?.messages
  return {
    interleavedThinking: host === 'direct' && policy?.interleavedThinkingBeta === true,
    webSearch: host === 'vertex' && policy?.vertexWebSearchBeta === true
  }
}
