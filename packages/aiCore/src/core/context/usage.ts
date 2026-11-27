import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { LanguageModelUsage } from 'ai'

/** Continuation hops bill the prompt repeatedly; context occupies it only once. */
export function getContextInputTokens(
  inputTokens: number | undefined,
  providerMetadata?: SharedV3ProviderMetadata
): number | undefined {
  const initialPromptTokens =
    providerMetadata?.google?.initialPromptTokenCount ?? providerMetadata?.vertex?.initialPromptTokenCount
  return typeof initialPromptTokens === 'number' && Number.isFinite(initialPromptTokens) && initialPromptTokens >= 0
    ? initialPromptTokens
    : inputTokens
}

/** An output-only usage report cannot anchor the conversation's context size. */
export function getContextTokens(
  usage: Pick<LanguageModelUsage, 'inputTokens' | 'totalTokens'>,
  providerMetadata?: SharedV3ProviderMetadata
): number | undefined {
  if (typeof usage.inputTokens !== 'number' || typeof usage.totalTokens !== 'number') return undefined
  const inputTokens = getContextInputTokens(usage.inputTokens, providerMetadata)
  return usage.totalTokens - usage.inputTokens + (inputTokens ?? usage.inputTokens)
}
