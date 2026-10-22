import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type AssistantMessage,
  calculateCost,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  InMemoryCredentialStore,
  type Message,
  type SimpleStreamOptions,
  type StreamFunction,
  type Tool,
  type TranscriptContext
} from '@earendil-works/pi-ai'
import { type AgentSession, ModelRuntime, type SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'
import { onTestFinished } from 'vitest'

import {
  type AgentRuntimeEvent,
  type AgentRuntimeModel,
  type AgentRuntimeSessionOptions,
  createAgentRuntimeSession
} from '../src'

export type ModelCall = TranscriptContext &
  SimpleStreamOptions & { model: AgentRuntimeModel; tools: Tool[]; systemPrompt: string }
export type TestStream = StreamFunction<string, SimpleStreamOptions>

export const MODEL: AgentRuntimeModel = {
  id: 'test-model',
  provider: 'test',
  api: 'test',
  baseUrl: 'https://fixture.invalid',
  name: 'Test model',
  reasoning: true,
  input: ['text', 'image'],
  contextWindow: 32_000,
  maxTokens: 4_096,
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }
}

export function assistantReply(
  content: string | AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
  input = 10,
  output = 5
): AssistantMessage {
  return {
    ...fauxAssistantMessage(content, { stopReason }),
    usage: {
      input,
      output,
      cacheRead: stopReason === 'error' ? 0 : 2,
      cacheWrite: 0,
      totalTokens: input + output + (stopReason === 'error' ? 0 : 2),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  }
}

/** Native scripted responses with fixed usage for budget and compaction assertions. */
export function respondingModel(
  respond: (call: ModelCall, index: number) => AssistantMessage | Promise<AssistantMessage>,
  delay = 0
) {
  const calls: ModelCall[] = []
  const model: TestStream = (model, context, options) => {
    const stream = createAssistantMessageEventStream()
    const call = {
      ...structuredClone(context),
      ...options,
      model,
      tools: getCurrentTools(context.messages),
      systemPrompt: getCurrentSystemPrompt(context.messages)
    }
    calls.push(call)
    const partial = { ...fauxAssistantMessage([]), api: model.api, provider: model.provider, model: model.id }
    let message = partial
    let abort!: () => void
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('Request aborted'))
    })
    options?.signal?.addEventListener('abort', abort, { once: true })
    void (async () => {
      try {
        options?.signal?.throwIfAborted()
        message = structuredClone(await Promise.race([respond(call, calls.length), aborted]))
        Object.assign(message, { api: model.api, provider: model.provider, model: model.id })
        calculateCost(model, message.usage)
        stream.push({ type: 'start', partial })
        for (const part of message.content) {
          const index = partial.content.length
          if (part.type === 'text') {
            const text = { ...part, text: '' }
            partial.content.push(text)
            stream.push({ type: 'text_start', contentIndex: index, partial })
            for (const delta of delay ? (part.text.match(/[\s\S]{1,4}/g) ?? ['']) : [part.text]) {
              if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
              options?.signal?.throwIfAborted()
              text.text += delta
              stream.push({ type: 'text_delta', contentIndex: index, delta, partial })
            }
            stream.push({ type: 'text_end', contentIndex: index, content: part.text, partial })
          } else {
            partial.content.push(part)
          }
        }
        if (message.stopReason === 'error' || message.stopReason === 'aborted')
          stream.push({ type: 'error', reason: message.stopReason, error: message })
        else if (message.stopReason !== 'pending') stream.push({ type: 'done', reason: message.stopReason, message })
      } catch (error) {
        message = {
          ...partial,
          stopReason: options?.signal?.aborted ? 'aborted' : 'error',
          errorMessage: String(error)
        }
        stream.push({ type: 'error', reason: message.stopReason === 'aborted' ? 'aborted' : 'error', error: message })
      } finally {
        options?.signal?.removeEventListener('abort', abort)
        stream.end(message)
      }
    })()
    return stream
  }
  return { model, calls }
}

export function scriptedModel(scripts: AssistantMessage[], delay?: number) {
  return respondingModel((_call, index) => scripts[Math.min(index - 1, scripts.length - 1)], delay)
}

export async function createTestBinding({
  stream,
  model = MODEL,
  signal
}: {
  stream: TestStream
  model?: AgentRuntimeModel
  signal?: AbortSignal
}) {
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerProvider(model.provider, {
    api: model.api,
    apiKey: 'fixture',
    baseUrl: model.baseUrl,
    models: [model],
    streamSimple: (model, context, options) =>
      stream(model, context, {
        ...options,
        signal: signal ? AbortSignal.any([...(options?.signal ? [options.signal] : []), signal]) : options?.signal
      })
  })
  return { modelRuntime, model: modelRuntime.getModel(model.provider, model.id)! }
}

export function tempDir(label: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `agent-runtime-${label}-`))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

type Defaulted = 'cwd' | 'agentDir' | 'model' | 'modelRuntime' | 'systemPrompt'
export type TestSessionOptions = Omit<AgentRuntimeSessionOptions, Defaulted> &
  Partial<Pick<AgentRuntimeSessionOptions, 'cwd' | 'agentDir' | 'systemPrompt'>> & {
    entries?: SessionEntry[]
    sessionId?: string
    history?: Message[]
    model?: AgentRuntimeModel
    stream: TestStream
    signal?: AbortSignal
  }

export async function createTestSession(options: TestSessionOptions) {
  const { stream, model, history, entries, sessionId, signal, ...sessionOptions } = options
  const binding = await createTestBinding({ stream, model, signal })
  const cwd = options.cwd ?? tempDir('cwd')
  const sessionManager = options.sessionManager ?? SessionManager.inMemory(cwd, { id: sessionId }, entries)
  for (const message of history ?? []) sessionManager.appendMessage(message)
  const runtime = await createAgentRuntimeSession({
    cwd,
    sessionManager,
    agentDir: options.agentDir ?? tempDir('agent'),
    systemPrompt: 'You are Cherry.',
    ...sessionOptions,
    settings: { retry: { enabled: false }, ...sessionOptions.settings },
    ...binding,
    subagents: options.subagents && {
      ...options.subagents,
      async configure(child) {
        const configured = await options.subagents!.configure(child)
        if (!configured.model || child.fork || configured.modelRuntime) return configured
        return { ...configured, ...(await createTestBinding({ stream, model: configured.model, signal })) }
      }
    }
  })
  onTestFinished(() => runtime.dispose())
  return runtime
}

export function lastAssistant(session: AgentSession): AssistantMessage {
  const message = session.messages.filter((m) => m.role === 'assistant').at(-1)
  if (!message) throw new Error('no assistant message')
  return message
}

export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const messageText = (message: Message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')

export function hostStore() {
  const entries: SessionEntry[] = []
  const events: AgentRuntimeEvent[] = []
  const onEvent = (event: AgentRuntimeEvent) => {
    events.push(event)
    if (event.type === 'session-append') entries.push(...plain(event.entries))
  }
  return { entries, events, onEvent }
}
