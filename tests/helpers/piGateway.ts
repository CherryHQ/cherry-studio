import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { type AssistantMessage, InMemoryCredentialStore, type Message } from '@earendil-works/pi-ai'
import {
  type AgentSession,
  ModelRuntime,
  type ProviderModelConfig,
  SessionManager
} from '@earendil-works/pi-coding-agent'
import {
  convertToModelMessages,
  type LanguageModel,
  type ModelMessage,
  simulateReadableStream,
  streamText,
  type ToolSet
} from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { onTestFinished } from 'vitest'

import { type AgentRuntimeSessionOptions, createAgentRuntimeSession } from '@cherrystudio/agent-runtime-pi'
import { loadPiApiStreamSimple } from '@main/ai/runtime/pi/piSdk'
import { type InputParamsMap, MessageConverterFactory, StreamAdapterFactory } from '@main/features/apiGateway/adapters'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

export type TestModel = Omit<Extract<ProviderModelConfig, { reasoning: boolean }>, 'id'> & { id: UniqueModelId }

export const MODEL: TestModel = {
  id: 'cherry::bridged-model',
  name: 'Gateway model',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096
}

interface GatewayRequest {
  sessionId: string | undefined
  model: { id: string }
  system: string
  messages: ModelMessage[]
  tools: ToolSet
  abortSignal: AbortSignal
}

/** A programmable upstream behind the production gateway's wire converters. */
export function gatewayModel(model: LanguageModel) {
  const requests: GatewayRequest[] = []
  return { upstream: { model, requests, signal: undefined as AbortSignal | undefined }, requests }
}

export type GatewayFixture = ReturnType<typeof gatewayModel>['upstream']

export async function createTestBinding({ port, model = MODEL }: { port: GatewayFixture; model?: TestModel }) {
  const server = createServer(async (request, response) => {
    const abort = new AbortController()
    response.on('close', () => abort.abort())
    const signal = port.signal ? AbortSignal.any([abort.signal, port.signal]) : abort.signal
    try {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body: InputParamsMap['openai'] = JSON.parse(raw)
      const converter = MessageConverterFactory.create('openai')
      const converted = await convertToModelMessages(converter.toUIMessages(body))
      const system = converted.flatMap((message) => (message.role === 'system' ? [message.content] : [])).join('\n')
      const messages = converted.filter((message) => message.role !== 'system')
      const tools = converter.toAiSdkTools?.(body) ?? {}
      port.requests.push({
        sessionId: request.headers['x-fixture-session']?.toString(),
        model: { id: body.model },
        system,
        messages,
        tools,
        abortSignal: signal
      })
      const result = streamText({
        ...converter.extractStreamOptions(body),
        model: port.model,
        system,
        messages,
        tools,
        maxRetries: 0,
        abortSignal: signal
      })
      const adapter = StreamAdapterFactory.createAdapter('openai', { model: body.model })
      const formatter = StreamAdapterFactory.getFormatter('openai')
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunks = result.toUIMessageStream({
        onError: (error) => (error instanceof Error ? error.message : String(error)),
        messageMetadata: ({ part }) => (part.type === 'finish' ? { stats: part.totalUsage } : undefined)
      })
      for await (const chunk of chunks) {
        if (chunk.type === 'error') throw new Error(chunk.errorText)
        for (const event of adapter.transformChunk(chunk)) response.write(formatter.formatEvent(event))
      }
      for (const event of adapter.finalizeEvents()) response.write(formatter.formatEvent(event))
      response.end(formatter.formatDone())
    } catch (error) {
      const payload = JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } })
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(payload)
      } else response.end(`data: ${payload}\n\n`)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Gateway fixture did not listen')
  const { providerId, modelId } = parseUniqueModelId(model.id)
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const nativeStream = await loadPiApiStreamSimple('openai-completions')
  modelRuntime.registerProvider(providerId, {
    streamSimple: (model, context, options) =>
      nativeStream(model, context, {
        ...options,
        maxRetries: 0,
        headers: { ...options?.headers, ...(options?.sessionId ? { 'x-fixture-session': options.sessionId } : {}) },
        signal: port.signal
          ? AbortSignal.any([...(options?.signal ? [options.signal] : []), port.signal])
          : options?.signal
      }),
    api: 'openai-completions',
    apiKey: 'fixture',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    models: [{ ...model, id: modelId, baseUrl: `http://127.0.0.1:${address.port}/v1` }]
  })
  return { modelRuntime, model: modelRuntime.getModel(providerId, modelId)! }
}

export function tempDir(label: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `agent-runtime-${label}-`))
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

type Defaulted = 'cwd' | 'agentDir' | 'model' | 'modelRuntime' | 'systemPrompt'
export type TestSessionOptions = Omit<AgentRuntimeSessionOptions, Defaulted> &
  Partial<Pick<AgentRuntimeSessionOptions, 'cwd' | 'agentDir' | 'systemPrompt'>> & {
    history?: Message[]
    model?: TestModel
    port: GatewayFixture
  }

export async function createTestSession(options: TestSessionOptions) {
  const { port, model, history, ...sessionOptions } = options
  const binding = await createTestBinding({ port, model })
  const cwd = options.cwd ?? tempDir('cwd')
  const sessionManager = options.sessionManager ?? SessionManager.inMemory(cwd)
  for (const message of history ?? []) sessionManager.appendMessage(message)
  const runtime = await createAgentRuntimeSession({
    cwd,
    sessionManager,
    agentDir: options.agentDir ?? tempDir('agent'),
    systemPrompt: 'You are Cherry.',
    ...sessionOptions,
    settings: { retry: { enabled: false }, ...sessionOptions.settings },
    ...binding
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

export const finish = (
  unified: 'stop' | 'tool-calls' | 'length' | 'other',
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
