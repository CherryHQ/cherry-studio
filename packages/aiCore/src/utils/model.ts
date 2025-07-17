export function isOpenAIChatCompletionOnlyModel(modelId: string): boolean {
  if (!modelId) {
    return false
  }

  return (
    modelId.includes('gpt-4o-search-preview') ||
    modelId.includes('gpt-4o-mini-search-preview') ||
    modelId.includes('o1-mini') ||
    modelId.includes('o1-preview')
  )
}

export function isOpenAIReasoningModel(modelId: string): boolean {
  return modelId.includes('o1') || modelId.includes('o3') || modelId.includes('o4')
}

export function isOpenAILLMModel(modelId: string): boolean {
  if (modelId.includes('gpt-4o-image')) {
    return false
  }
  if (isOpenAIReasoningModel(modelId)) {
    return true
  }
  if (modelId.includes('gpt')) {
    return true
  }
  return false
}

export function getModelToProviderId(modelId: string): string | 'openai-compatible' {
  const id = modelId.toLowerCase()

  if (id.startsWith('claude')) {
    return 'anthropic'
  }

  if ((id.startsWith('gemini') || id.startsWith('imagen')) && !id.endsWith('-nothink') && !id.endsWith('-search')) {
    return 'google'
  }

  if (isOpenAILLMModel(modelId)) {
    return 'openai'
  }

  return 'openai-compatible'
}
