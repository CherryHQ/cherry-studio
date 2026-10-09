import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { type LanguageModel, simulateReadableStream, streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { onTestFinished } from 'vitest'

import {
  type AgentRuntimeModel,
  type AgentRuntimeSessionOptions,
  createAgentRuntimeSession,
  type ModelCallPort,
  type ModelCallRequest
} from '../src'

export const MODEL: AgentRuntimeModel = {
  provider: 'cherry',
  id: 'bridged-model',
  name: 'Bridged model',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096
}

export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const finish = (
  unified: 'stop' | 'tool-calls' | 'length',
  input = 10,
  output = 5
): LanguageModelV3StreamPart => ({
  type: 'finish',
  usage: {
    inputTokens: { total: input + 2, noCache: input, cacheRead: 2, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: undefined }
  },
  finishReason: { unified, raw: unified }
})

export const textParts = (id: string, ...deltas: string[]): LanguageModelV3StreamPart[] => [
  { type: 'text-start', id },
  ...deltas.map((delta) => ({ type: 'text-delta' as const, id, delta })),
  { type: 'text-end', id }
]

/** A mock whose Nth model call replays the Nth script (the last one repeats). */
export function scriptedModel(scripts: LanguageModelV3StreamPart[][], chunkDelayInMs?: number) {
  const calls: LanguageModelV3CallOptions[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls.push(options)
      const chunks = scripts[Math.min(calls.length - 1, scripts.length - 1)]
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs }) }
    }
  })
  return { model, calls }
}

/** The production shape of the port: one single-step `streamText` call (Cherry adds its executor here). */
export function streamTextPort<TRequestOptions = undefined>(
  model: LanguageModel,
  extra: Pick<Parameters<typeof streamText>[0], 'experimental_transform'> = {}
) {
  const requests: ModelCallRequest<TRequestOptions>[] = []
  const port: ModelCallPort<TRequestOptions> = {
    streamText(request) {
      requests.push(request)
      return streamText({
        model,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature,
        abortSignal: request.abortSignal,
        maxRetries: 0,
        ...extra
      })
    }
  }
  return { port, requests }
}

export function tempDir(label: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `agent-runtime-${label}-`))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

type Defaulted = 'cwd' | 'agentDir' | 'model' | 'systemPrompt' | 'requestOptions'
export type TestSessionOptions<TRequestOptions> = Omit<AgentRuntimeSessionOptions<TRequestOptions>, Defaulted> &
  Partial<Pick<AgentRuntimeSessionOptions<TRequestOptions>, Defaulted>>

export async function createTestSession<TRequestOptions = undefined>(options: TestSessionOptions<TRequestOptions>) {
  const runtime = await createAgentRuntimeSession<TRequestOptions>({
    cwd: options.cwd ?? tempDir('cwd'),
    agentDir: options.agentDir ?? tempDir('agent'),
    model: MODEL,
    systemPrompt: 'You are Cherry.',
    requestOptions: undefined as TRequestOptions,
    ...options
  })
  onTestFinished(() => runtime.dispose())
  return runtime
}

export function lastAssistant(session: AgentSession): AssistantMessage {
  const message = session.messages.filter((m) => m.role === 'assistant').at(-1)
  if (!message) throw new Error('no assistant message')
  return message
}
