/**
 * Streaming agent loop. See `docs/references/ai/agent-loop.md`.
 */

import { createAgent } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import type { LanguageModelUsage, ModelMessage, ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages } from 'ai'

import type { AppProviderSettingsMap } from '../../types'
import type { AgentLoopHooks, AgentLoopParams } from './loop'
import { logger, safeCall, wrapForwardedHook, wrapToolsWithExecutionHooks } from './loop/internal'
import { attachUsageObserver } from './observers/usage'
import { composeHooks } from './params/composeHooks'

type AppProviderKey = StringKeys<AppProviderSettingsMap>

type ObserverMap = {
  [K in keyof AgentLoopHooks]?: Array<NonNullable<AgentLoopHooks[K]>>
}

export class Agent<T extends AppProviderKey = AppProviderKey> {
  private readonly observers: ObserverMap = {}
  private currentWriter?: WritableStreamDefaultWriter<UIMessageChunk>

  constructor(public readonly params: AgentLoopParams<T>) {
    attachUsageObserver(this as Agent)
  }

  /** Internal observer — composes ahead of caller hookParts via `composeHooks`. */
  on<K extends keyof AgentLoopHooks>(key: K, fn: NonNullable<AgentLoopHooks[K]>): () => void {
    const list = (this.observers[key] ??= []) as Array<NonNullable<AgentLoopHooks[K]>>
    list.push(fn)
    return () => {
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    }
  }

  /** No-op when no `stream()` is in flight. Used by `attachUsageObserver`. */
  write(chunk: UIMessageChunk): void {
    void this.currentWriter?.write(chunk).catch(() => {
      // Writer may already be closing from a peer cancel — swallow.
    })
  }

  private composedHooks(): AgentLoopHooks {
    const parts: Array<Partial<AgentLoopHooks>> = []
    for (const key of Object.keys(this.observers) as Array<keyof AgentLoopHooks>) {
      const list = this.observers[key]
      if (!list) continue
      for (const fn of list) {
        parts.push({ [key]: fn } as Partial<AgentLoopHooks>)
      }
    }
    if (this.params.hookParts) parts.push(...this.params.hookParts)
    return composeHooks(parts)
  }

  private async buildAiSdkAgent(hooks: AgentLoopHooks) {
    const params = this.params
    const opts = params.options ?? {}
    const toolsWithHooks = wrapToolsWithExecutionHooks(params.tools, hooks)
    return createAgent<AppProviderSettingsMap, T, ToolSet>({
      providerId: params.providerId,
      providerSettings: params.providerSettings,
      modelId: params.modelId,
      plugins: params.plugins,
      agentSettings: {
        // Tools
        tools: toolsWithHooks as ToolSet,
        toolChoice: opts.toolChoice,
        activeTools: opts.activeTools as Array<keyof ToolSet>,
        // System
        instructions: params.system,
        // CallSettings (model parameters)
        maxOutputTokens: opts.maxOutputTokens,
        temperature: opts.temperature,
        topP: opts.topP,
        topK: opts.topK,
        presencePenalty: opts.presencePenalty,
        frequencyPenalty: opts.frequencyPenalty,
        stopSequences: opts.stopSequences,
        seed: opts.seed,
        maxRetries: opts.maxRetries,
        timeout: opts.timeout,
        headers: opts.headers,
        // Provider-specific
        providerOptions: opts.providerOptions,
        // Loop control
        stopWhen: opts.stopWhen,
        // Experimental
        experimental_telemetry: opts.telemetry,
        experimental_context: opts.context,
        experimental_repairToolCall: opts.repairToolCall,
        experimental_download: opts.download,
        prepareStep: wrapForwardedHook('prepareStep', hooks.prepareStep),
        onStepFinish: wrapForwardedHook('onStepFinish', hooks.onStepFinish)
      }
    })
  }

  async generate(
    input: { prompt: string } | { messages: ModelMessage[] },
    signal?: AbortSignal
  ): Promise<{ text: string; usage: LanguageModelUsage }> {
    const hooks = this.composedHooks()
    try {
      await safeCall('onStart', hooks.onStart)
      const aiAgent = await this.buildAiSdkAgent(hooks)
      const generateInput =
        'prompt' in input
          ? { prompt: input.prompt, ...(signal && { abortSignal: signal }) }
          : { messages: input.messages, ...(signal && { abortSignal: signal }) }
      const result = await aiAgent.generate(generateInput)
      await safeCall('onFinish', hooks.onFinish)
      return { text: result.text, usage: result.usage }
    } catch (err) {
      logger.error('agent generate error', err as Error)
      if (hooks.onError) {
        try {
          await hooks.onError({ error: err instanceof Error ? err : new Error(String(err)) })
        } catch (hookErr) {
          logger.error('hooks.onError threw; rethrowing original', hookErr as Error)
        }
      }
      throw err
    }
  }

  stream(initialMessages: UIMessage[], signal: AbortSignal): ReadableStream<UIMessageChunk> {
    const params = this.params
    const { readable, writable } = new TransformStream<UIMessageChunk>()
    const writer = writable.getWriter()
    this.currentWriter = writer
    const hooks = this.composedHooks()

    let writerSettled = false
    const settleWriter = async (err?: unknown): Promise<void> => {
      if (writerSettled) return
      writerSettled = true
      this.currentWriter = undefined
      try {
        if (err === undefined) {
          await writer.close()
        } else {
          await writer.abort(err)
        }
      } catch {
        // The transform stream's writer may already be closing from a peer
        // cancel; we only care that the terminal state was signalled once.
      }
    }

    const invokeOnError = async (err: unknown): Promise<'retry' | 'abort' | void> => {
      if (!hooks.onError) return undefined
      try {
        return await hooks.onError({
          error: err instanceof Error ? err : new Error(String(err))
        })
      } catch (hookErr) {
        logger.error('hooks.onError threw; aborting run', hookErr as Error)
        return 'abort'
      }
    }

    ;(async () => {
      await safeCall('onStart', hooks.onStart)

      const aiAgent = await this.buildAiSdkAgent(hooks)

      const messages = initialMessages
      const modelMessages = await convertToModelMessages(initialMessages)
      let hasUsedProvidedMessageId = false

      const result = await aiAgent.stream({
        messages: modelMessages,
        abortSignal: signal
      })

      const uiStream = result.toUIMessageStream({
        originalMessages: messages,
        generateMessageId: () => {
          if (!hasUsedProvidedMessageId && params.messageId) {
            hasUsedProvidedMessageId = true
            return params.messageId
          }
          return crypto.randomUUID()
        }
      })
      const reader = uiStream.getReader()
      let readError: unknown
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || signal.aborted) break
          await writer.write(value)
        }
      } catch (error) {
        readError = error
      } finally {
        reader.releaseLock()
      }
      if (readError) throw readError

      // onFinish is success-only by current design: it fires only when the
      // stream drains cleanly, never on the error/abort path below (which
      // routes through invokeOnError + settleWriter instead). Failed-turn
      // analytics must therefore accumulate via onStepFinish rather than rely
      // on onFinish. Whether onFinish should become terminal (also firing on
      // error/abort) is a deferred design decision — see agent-loop.md.
      await safeCall('onFinish', hooks.onFinish)
    })()
      .then(() => settleWriter())
      .catch(async (err) => {
        if (!signal.aborted) {
          const action = await invokeOnError(err)
          if (action === 'retry') {
            // TODO: retry logic
            // retry is reserved for a future implementation — today the loop logs and aborts.
            logger.warn('agentLoop onError returned retry; retry not implemented — aborting', err)
          } else {
            logger.error('agentLoop error', err)
          }
        }
        await settleWriter(err)
      })

    return readable
  }
}
