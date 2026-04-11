const getProviderIdFromModelId = (modelId?: string | null): string | undefined => {
  if (!modelId || !modelId.includes(':')) {
    return undefined
  }

  return modelId.split(':', 1)[0]
}

/**
 * Claude Code sessions are provider-specific. When the provider changes, the
 * previous SDK session can carry incompatible context and must not be reused.
 */
export const canResumeClaudeSession = (currentModelId: string, lastModelId?: string | null): boolean => {
  const currentProviderId = getProviderIdFromModelId(currentModelId)
  const lastProviderId = getProviderIdFromModelId(lastModelId)

  if (!currentProviderId || !lastProviderId) {
    return false
  }

  return currentProviderId === lastProviderId
}
