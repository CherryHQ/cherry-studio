/**
 * Agent — class wrapping the streaming agent loop.
 *
 * The flow:
 *   1. `onStart` hook fires once.
 *   2. Build the AI SDK agent ONCE — config doesn't change between calls.
 *   3. Loop: call `agent.stream(messages)`. The steering observer drains
 *      `pendingMessages` mid-flight via `prepareStep`. After the stream
 *      settles, tail recheck — if the user injected a message after AI SDK's
 *      last `prepareStep` fired, drain it and call `agent.stream` again
 *      with the appended messages.
 *   4. `onFinish` hook fires once.
 *
 * Hooks come from N independent contributors (`AgentLoopParams.hookParts`):
 * features' `RequestFeature.contributeHooks`, the AiService analytics part,
 * etc. Internal observers (`Agent.on(key, fn)`) — usage, steering — fold
 * into the same `composeHooks` pass, observers running ahead of caller
 * hookParts. Symmetric across every hook key.
 *
 * Future: `runToCompletion()` / `toTool()` for subagent and agent-as-tool
 * composition (gated on a real consumer landing).
 */

import { createAgent } from '@cherrystudio/ai-core'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import type { Message } from '@shared/data/types/message'
import type { LanguageModelUsage, ModelMessage, Tool, ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages, isTextUIPart, readUIMessageStream, tool } from 'ai'

import type { AppProviderSettingsMap } from '../types'
import type { AgentLoopHooks, AgentLoopParams } from './loop'
import { logger, safeCall, wrapForwardedHook, wrapToolsWithExecutionHooks } from './loop/internal'
import { attachSteeringObserver } from './observers/steering'
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
    if (params.pendingMessages) {
      attachSteeringObserver(this as Agent, params.pendingMessages)
    }
  }

  /**
   * Register an internal observer for a hook. Composes with caller
   * hookParts via `composeHooks` — observers run first, caller parts after,
   * errors are isolated per chain link.
   */
  on<K extends keyof AgentLoopHooks>(key: K, fn: NonNullable<AgentLoopHooks[K]>): () => void {
    const list = (this.observers[key] ??= []) as Array<NonNullable<AgentLoopHooks[K]>>
    list.push(fn)
    return () => {
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    }
  }

  /**
   * Emit a chunk on the active stream's writer. No-op when no `stream()` is
   * in flight. Used by `attachUsageObserver` to inject `message-metadata`.
   */
  write(chunk: UIMessageChunk): void {
    void this.currentWriter?.write(chunk).catch(() => {
      // Writer may already be closing from a peer cancel — swallow.
    })
  }

  /**
   * Deliver a synthetic message into the parent's pending-message channel.
   * Used by both in-loop observers (token-budget, compaction trigger) firing
   * via `Agent.on(hookKey, fn)`, and out-of-loop producers (async sub-agent
   * drainer) that take an explicit `inject` callback. Returns false when
   * the channel is unwired or the parent stream is already dead.
   */
  injectReminder(message: Message): boolean {
    return this.params.inject?.(message) ?? false
  }

  /**
   * Fold all internal observers + caller hookParts into a single
   * `AgentLoopHooks`. Each observer is a singleton `Partial<AgentLoopHooks>`;
   * `composeHooks` already encodes the per-hook composition semantics
   * (void-fan-out / chained prepareStep / etc.).
   */
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

  /**
   * Build the AI SDK agent. Shared by `stream()` and `generate()` —
   * config is identical, only the underlying call (`agent.stream` vs
   * `agent.generate`) differs.
   */
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

  toTool<TInput = unknown>(opts: {
    description: string
    inputSchema: Tool['inputSchema']
    /** Map structured tool input → child agent prompt. Default: `JSON.stringify(input)`. */
    toPrompt?: (input: TInput) => string
  }): Tool {
    return tool({
      description: opts.description,
      inputSchema: opts.inputSchema,
      execute: (input: unknown, options) =>
        this.executeAsTool(opts.toPrompt ? opts.toPrompt(input as TInput) : JSON.stringify(input), options.abortSignal)
    })
  }

  /**
   * Run this agent as a sub-agent tool: yield cumulative text deltas,
   * return the final text. Used by `toTool()` (static binding) and the
   * `agent` meta-tool (dynamic spawn). Reasoning / tool-call parts are
   * NOT relayed.
   */
  async *executeAsTool(prompt: string, abortSignal: AbortSignal | undefined): AsyncGenerator<string, string> {
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: prompt }]
    }
    const stream = this.stream([userMessage], abortSignal)

    let last = ''
    // terminateOnError: surface child stream errors to the caller (Agent.toTool
    // / agent meta-tool's async drainer). Default `false` would silently
    // truncate, leaving callers to think the run "completed" with empty text.
    for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
      const text = message.parts
        .filter(isTextUIPart)
        .map((p) => p.text)
        .join('')
      if (text !== last) {
        last = text
        yield text
      }
    }
    return last
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

  stream(initialMessages: UIMessage[], signal?: AbortSignal): ReadableStream<UIMessageChunk> {
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
        params.pendingMessages?.close()
      } catch {
        // pendingMessages.close() already idempotent in practice — swallow
        // defensively; we don't want cleanup to block stream termination.
      }
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
      // ★ onStart — usage observer resets `cumulativeUsage` here.
      await safeCall('onStart', hooks.onStart)

      // ◆ AI SDK: build ONCE — config doesn't change across tail-recheck
      // rounds. Steering folds into prepareStep, which sees the live messages
      // array on every step.
      const aiAgent = await this.buildAiSdkAgent(hooks)

      let messages = initialMessages
      let modelMessages = await convertToModelMessages(initialMessages)
      let hasUsedProvidedMessageId = false

      // Tail recheck loop. Most runs exit after one iteration. A second
      // round only happens if the user injected a follow-up after AI SDK's
      // last `prepareStep` fired — the steering observer can't catch that
      // race, but a post-stream drain does.
      while (!signal?.aborted) {
        const result = await aiAgent.stream({
          messages: modelMessages,
          ...(signal && { abortSignal: signal })
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
            if (done || signal?.aborted) break
            await writer.write(value)
          }
        } catch (error) {
          readError = error
        } finally {
          reader.releaseLock()
        }
        if (readError) throw readError

        const response = await result.response

        // Tail recheck: did anyone inject after the steering observer's
        // last drain? If yes, append and re-stream with assistant turn
        // included as context.
        const tail = params.pendingMessages?.drain() ?? []
        if (tail.length === 0) break

        const tailUI: UIMessage[] = tail.map((msg) => ({
          id: msg.id,
          role: 'user' as const,
          parts: msg.data?.parts ?? []
        }))
        const tailModel = await convertToModelMessages(tailUI)
        const assistantPlaceholderUI: UIMessage = {
          id: response.id,
          role: 'assistant',
          parts: []
        }
        messages = [...messages, assistantPlaceholderUI, ...tailUI]
        modelMessages = [...modelMessages, ...(response.messages as ModelMessage[]), ...tailModel]
      }

      // ★ onFinish (analytics, otel root span). Cleanup is centralised in
      // `settleWriter` below — don't close `pendingMessages` here, the `.then`
      // handler will do it exactly once.
      await safeCall('onFinish', hooks.onFinish)
    })()
      .then(() => settleWriter())
      .catch(async (err) => {
        if (!signal?.aborted) {
          const action = await invokeOnError(err)
          if (action !== 'retry') {
            logger.error('agentLoop error', err)
          }
          // TODO: retry logic
        }
        await settleWriter(err)
      })

    return readable
  }
}
