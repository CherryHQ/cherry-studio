import type { LanguageModelV3Message, SharedV3ProviderOptions } from '@ai-sdk/provider'
import type { ModelMessage, UIMessage } from 'ai'

export function geminiSignatures(options: SharedV3ProviderOptions | undefined): Array<[string, string]> {
  const signatures: Array<[string, string]> = []
  for (const [namespace, optionsValue] of Object.entries(options ?? {})) {
    const signature = optionsValue?.thoughtSignature
    if (typeof signature === 'string' && signature.trim()) signatures.push([namespace, signature])
  }
  return signatures
}

export function isSignedGeminiWhitespace(text: string, options: SharedV3ProviderOptions | undefined): boolean {
  return text.length > 0 && !text.trim() && geminiSignatures(options).length > 0
}

export function hasSignedGeminiWhitespace(messages: UIMessage[] | undefined): boolean {
  return (
    messages?.some(
      (message) =>
        message.role === 'assistant' &&
        message.parts.some((part) => part.type === 'text' && isSignedGeminiWhitespace(part.text, part.providerMetadata))
    ) === true
  )
}

export function omitSignedGeminiWhitespace<T extends ModelMessage | LanguageModelV3Message>(messages: T[]): T[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || typeof message.content === 'string') return message
    const content = message.content.filter(
      (part) => part.type !== 'text' || !isSignedGeminiWhitespace(part.text, part.providerOptions)
    )
    if (content.length === message.content.length) return message
    return { ...message, content: content.length ? content : [{ type: 'text', text: '...' }] }
  })
}
