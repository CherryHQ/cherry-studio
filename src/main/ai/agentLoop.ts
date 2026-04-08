import type { AiPlugin } from '@cherrystudio/ai-core'
import { createAgent } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import { loggerService } from '@logger'
import type { LanguageModelUsage, ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages } from 'ai'

import type { AppProviderSettingsMap } from './types'

const logger = loggerService.withContext('agentLoop')

/** Strict provider ID — must be a known key of AppProviderSettingsMap */
type AppProviderKey = StringKeys<AppProviderSettingsMap>

export interface AgentLoopParams<T extends AppProviderKey = AppProviderKey> {
  providerId: T
  providerSettings: AppProviderSettingsMap[T]
  modelId: string
  plugins?: AiPlugin[]
  tools?: ToolSet
  system?: string
  /** Called after stream completes with total token usage. */
  onFinish?: (usage: LanguageModelUsage) => void
}

/**
 * Run the agent loop and return a continuous ReadableStream of UIMessageChunks.
 *
 * Phase 1: single-pass (no outer while loop).
 * createAgent() → agent.stream() → toUIMessageStream() → pipe to TransformStream.
 *
 * Phase 2 will add: outer while(true) for PendingMessageQueue steering,
 * context compilation from DB, prompt cache-friendly prefix stability.
 */
export function runAgentLoop<T extends AppProviderKey>(
  params: AgentLoopParams<T>,
  messages: UIMessage[],
  signal: AbortSignal
): ReadableStream<UIMessageChunk> {
  const { readable, writable } = new TransformStream<UIMessageChunk>()
  const writer = writable.getWriter()

  ;(async () => {
    const modelMessages = await convertToModelMessages(messages)

    const agent = await createAgent<AppProviderSettingsMap, T>({
      providerId: params.providerId,
      providerSettings: params.providerSettings,
      modelId: params.modelId,
      plugins: params.plugins,
      agentSettings: {
        tools: params.tools as ToolSet,
        instructions: params.system
      }
    })

    const result = await agent.stream({
      messages: modelMessages,
      abortSignal: signal
    })

    const uiStream = result.toUIMessageStream()
    const reader = uiStream.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done || signal.aborted) break
        await writer.write(value)
      }
    } finally {
      reader.releaseLock()
    }

    // Report usage after stream completes
    if (params.onFinish) {
      const totalUsage = await result.totalUsage
      params.onFinish(totalUsage)
    }
  })()
    .then(() => writer.close())
    .catch((err) => {
      if (!signal.aborted) {
        logger.error('agentLoop error', err)
      }
      writer.abort(err).catch(() => {})
    })

  return readable
}
