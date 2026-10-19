import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type JsonObject,
  type Model,
  type Usage
} from '@earendil-works/pi-ai'
import { type ExtensionFactory, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { onTestFinished } from 'vitest'

import type { ContractHarness, HarnessPorts, ScriptedReply, UsageFact } from '@cherrystudio/agent-behavior'

import {
  type AgentRuntimeSession,
  type BehaviorSessionRequest,
  createAgentRuntimeSession,
  createPiBehavior,
  type PiBehavior
} from '../src'

type Script = {
  readonly replies: ScriptedReply[]
  cursor: number
  calls: number
  readonly requests: Context['messages'][]
}

export type PiHarness = {
  readonly harness: ContractHarness
  readonly behavior: PiBehavior
  /** The sessions' working directory, removed when the test ends. */
  readonly cwd: string
  /** The messages each model request of `thread` carried. */
  requests(thread: string): readonly Context['messages'][]
  /** Errors the adapter reported through `onError`. */
  readonly errors: unknown[]
}

const piUsage = (usage?: UsageFact): Usage => ({
  input: usage?.input ?? 0,
  output: usage?.output ?? 0,
  cacheRead: usage?.cacheRead ?? 0,
  cacheWrite: usage?.cacheWrite ?? 0,
  totalTokens: usage?.totalTokens ?? 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage?.costUsd ?? 0 }
})

/** One reply as Pi's stream: start, then done or error. */
function streamOf(model: Model<Api>, reply: Partial<AssistantMessage>): AssistantMessageEventStream {
  const message: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: piUsage(),
    stopReason: 'stop',
    timestamp: Date.now(),
    ...reply
  }
  const stream = createAssistantMessageEventStream()
  stream.push({ type: 'start', partial: message })
  if (message.stopReason === 'error' || message.stopReason === 'aborted')
    stream.push({ type: 'error', reason: message.stopReason, error: message })
  else stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message })
  stream.end(message)
  return stream
}

function replyOf(reply: ScriptedReply, nextCallId: () => string): Partial<AssistantMessage> {
  if ('error' in reply) return { stopReason: 'error', errorMessage: reply.error }
  const calls = (reply.toolCalls ?? []).map((call) => ({
    type: 'toolCall' as const,
    id: nextCallId(),
    name: call.name,
    arguments: call.args as JsonObject
  }))
  return {
    content: [...(reply.text ? [{ type: 'text' as const, text: reply.text }] : []), ...calls],
    stopReason: calls.length > 0 ? 'toolUse' : 'stop',
    usage: piUsage(reply.usage)
  }
}

type OpenSession = (request: BehaviorSessionRequest) => Promise<AgentRuntimeSession>

/**
 * The coding-agent harness the contract drives: real sessions from `createAgentRuntimeSession` over a provider that
 * answers each conversation from its own script. `extensions` go ahead of the adapter's in every session; `openSession`
 * wraps how each session is built (to hold or fail a build).
 */
export async function openPiHarness(
  install: (ports: HarnessPorts) => void,
  extensions: readonly ExtensionFactory[] = [],
  openSession: (request: BehaviorSessionRequest, open: OpenSession) => Promise<AgentRuntimeSession> = (request, open) =>
    open(request)
): Promise<PiHarness> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-behavior-'))
  const scripts = new Map<string, Script>()
  const scriptOf = (thread: string): Script => {
    const found = scripts.get(thread)
    if (found) return found
    const created: Script = { replies: [], cursor: 0, calls: 0, requests: [] }
    scripts.set(thread, created)
    return created
  }
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerProvider('contract', {
    api: 'contract',
    apiKey: 'unused',
    baseUrl: 'https://contract.invalid',
    models: [
      {
        id: 'model',
        name: 'Contract',
        reasoning: false,
        input: ['text'],
        contextWindow: 32000,
        maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    // Requests carry their session's id, so each conversation reads its own script.
    streamSimple(model, context, options) {
      const script = scriptOf(options?.sessionId ?? '')
      script.requests.push(context.messages)
      if (options?.signal?.aborted)
        return streamOf(model, { stopReason: 'aborted', errorMessage: 'Request was aborted' })
      const reply = script.replies[script.cursor] ?? { error: 'script exhausted' }
      script.cursor += 1
      return streamOf(
        model,
        replyOf(reply, () => `call-${(script.calls += 1)}`)
      )
    }
  })
  const model = modelRuntime.getModel('contract', 'model')!
  const errors: unknown[] = []
  const open: OpenSession = ({ sessionManager, extension }) =>
    createAgentRuntimeSession({
      cwd,
      agentDir: cwd,
      modelRuntime,
      model,
      sessionManager,
      extensionFactories: [...extensions, extension],
      settings: { retry: { enabled: false }, cacheWarming: 'off' },
      // Manual compaction only, summarized without a model request, so it never takes a scripted reply.
      compaction: {
        enabled: false,
        reserveTokens: 1,
        keepRecentTokens: 1,
        summarize: async () => 'Contract summary.'
      }
    })
  const behavior = createPiBehavior({
    install,
    openSession: (request) => openSession(request, open),
    onError: (error) => {
      errors.push(error)
    }
  })
  onTestFinished(async () => {
    await behavior.close()
    rmSync(cwd, { recursive: true, force: true })
  })
  const harness: ContractHarness = {
    createThread: () => behavior.openConversation(SessionManager.inMemory(cwd)),
    withCall: (thread, use) => behavior.withCall(thread, use),
    script: (thread, replies) => {
      scriptOf(thread).replies.push(...replies)
    },
    sendUser: (thread, text) => behavior.submitUser(thread, text),
    compact: (thread) => behavior.compact(thread),
    settle: () => behavior.settled(),
    restart: () => Promise.reject(new Error('coding-agent resumes no runs; the restart cases are skipped')),
    close: () => behavior.close()
  }
  return { harness, behavior, cwd, requests: (thread) => scriptOf(thread).requests, errors }
}
