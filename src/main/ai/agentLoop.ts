import type { CreateAgentOptions } from '@cherrystudio/ai-core'
import { createAgent } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import type { ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages } from 'ai'

const logger = loggerService.withContext('agentLoop')

export interface AgentLoopParams {
  providerId: string
  providerSettings: unknown
  modelId: string
  plugins: CreateAgentOptions['plugins']
  tools?: ToolSet
  system?: string
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
export function runAgentLoop(
  params: AgentLoopParams,
  messages: UIMessage[],
  signal: AbortSignal
): ReadableStream<UIMessageChunk> {
  const { readable, writable } = new TransformStream<UIMessageChunk>()
  const writer = writable.getWriter()

  ;(async () => {
    const modelMessages = await convertToModelMessages(messages)

    const agent = await createAgent({
      providerId: params.providerId as any,
      providerSettings: params.providerSettings as any,
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
