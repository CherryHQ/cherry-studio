import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type * as NodeLlamaCpp from 'node-llama-cpp'
import type { ChatHistoryItem, ChatModelFunctions, Llama, LlamaContextSequence, LlamaModel } from 'node-llama-cpp'

import {
  LLM_CONTEXT_OVERFLOW,
  type LlmChatMessage,
  type LlmGenerateInput,
  type LlmGenerateResult,
  type LlmInferenceContract,
  type LlmInitData
} from '@main/ai/localModel/capabilities/llm/protocol'
import { toGbnfJsonSchema, toToolArguments } from '@main/ai/localModel/capabilities/llm/toolSchema'
import type {
  UtilityProcessHandlers,
  UtilityProcessLogger
} from '@main/core/utilityProcess/runtime/serveUtilityProcess'

interface LoadedModel {
  modelPath: string
  model: LlamaModel
  sequence: LlamaContextSequence
}

let appPath: string
let logger: UtilityProcessLogger
let runtime: typeof NodeLlamaCpp | undefined
let llama: Llama | undefined
let loaded: LoadedModel | undefined
// A cancelled generation settles at its next token; the next one must not share the sequence before that.
let queue: Promise<unknown> = Promise.resolve()

const FINISH_REASONS = {
  eogToken: 'stop',
  stopGenerationTrigger: 'stop',
  customStopTrigger: 'stop',
  maxTokens: 'length',
  functionCalls: 'tool-calls',
  abort: 'other'
} as const satisfies Record<string, LlmGenerateResult['finishReason']>

export function initializeLlm(data: LlmInitData, context: { logger: UtilityProcessLogger }): void {
  appPath = data.appPath
  logger = context.logger
  process.env.CHERRY_NODE_LLAMA_CPP_BINS_DIR = data.binsDir
}

export async function disposeLlm(): Promise<void> {
  const previous = loaded
  loaded = undefined
  await previous?.model.dispose()
  await llama?.dispose()
  llama = undefined
}

async function loadModel(modelPath: string, maxContextSize: number): Promise<LoadedModel> {
  if (loaded?.modelPath === modelPath) return loaded
  const previous = loaded
  loaded = undefined
  await previous?.model.dispose()
  runtime ??= (await import(
    pathToFileURL(createRequire(`${appPath}/`).resolve('node-llama-cpp')).href
  )) as typeof NodeLlamaCpp
  llama ??= await runtime.getLlama({
    gpu: 'auto',
    build: 'never',
    logLevel: runtime.LlamaLogLevel.warn,
    logger: (level, message) => logger[level === runtime!.LlamaLogLevel.warn ? 'warn' : 'error'](message)
  })
  const model = await llama.loadModel({ modelPath })
  // eslint-disable-next-line @eslint-react/naming-convention/context-name -- a llama.cpp context, not React
  const llamaContext = await model.createContext({ contextSize: { max: maxContextSize } })
  logger.info('local chat model loaded', { gpu: llama.gpu, contextSize: llamaContext.contextSize })
  loaded = { modelPath, model, sequence: llamaContext.getSequence() }
  return loaded
}

function toChatHistory(messages: LlmChatMessage[]): ChatHistoryItem[] {
  const history = messages.map((message): ChatHistoryItem => {
    if (message.role !== 'assistant') return { type: message.role, text: message.text }
    const calls = (message.toolCalls ?? []).map((call) => ({ type: 'functionCall' as const, ...call }))
    return { type: 'model', response: [...(message.text ? [message.text] : []), ...calls] }
  })
  // LlamaChat completes the trailing model item: after tool results it continues that turn,
  // otherwise a new reply starts from an empty one.
  if (messages.at(-1)?.role !== 'assistant') history.push({ type: 'model', response: [] })
  return history
}

function toFunctions(tools: LlmGenerateInput['tools']): ChatModelFunctions | undefined {
  if (!tools?.length) return undefined
  return Object.fromEntries(
    tools.map((tool) => [tool.name, { description: tool.description, params: toGbnfJsonSchema(tool.parameters) }])
  )
}

// node-llama-cpp throws a plain Error when even the system prompt and latest turn exceed the context:
// its context shift strategy fails to compress the history, or returns one that still does not fit.
export function isContextOverflow(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('Failed to compress chat history') ||
      error.message.includes('did not return a history that fits the context size'))
  )
}

function contextOverflowError(contextSize: number): Error {
  return Object.assign(new Error(`Prompt is too long for this local model's ${contextSize}-token context window`), {
    code: LLM_CONTEXT_OVERFLOW
  })
}

export const llmHandlers: UtilityProcessHandlers<LlmInferenceContract> = {
  generate(input, { signal, emit }) {
    const run = queue.then(async (): Promise<LlmGenerateResult> => {
      signal.throwIfAborted()
      const state = await loadModel(input.modelPath, input.runtime.maxContextSize)
      signal.throwIfAborted()
      const sampling = { ...input.runtime.sampling, ...input.sampling }
      // The model's own chat wrapper opens a thought segment on every reply, and LlamaChat checkpoints
      // the hybrid model's state just before it, so the next turn resumes there instead of re-reading the prompt.
      const chat = new runtime!.LlamaChat({ contextSequence: state.sequence })
      let outputTokens = 0
      let textStarted = false
      try {
        const result = await chat.generateResponse(toChatHistory(input.messages), {
          signal,
          stopOnAbortSignal: true,
          functions: toFunctions(input.tools),
          budgets: input.thinking ? undefined : { thoughtTokens: 0 },
          maxTokens: input.maxOutputTokens,
          temperature: sampling.temperature,
          topP: sampling.topP,
          topK: sampling.topK,
          repeatPenalty: { presencePenalty: sampling.presencePenalty },
          onResponseChunk: (chunk) => {
            outputTokens += chunk.tokens.length
            if (chunk.type === 'segment') {
              // A zero thought budget still lets the first thought token through.
              if (input.thinking && chunk.text) emit({ type: 'reasoning', delta: chunk.text })
              return
            }
            const delta = textStarted ? chunk.text : chunk.text.trimStart()
            if (!delta) return
            textStarted = true
            emit({ type: 'text', delta })
          }
        })
        return {
          finishReason: FINISH_REASONS[result.metadata.stopReason],
          toolCalls: result.functionCalls?.map((call) => ({
            name: call.functionName,
            params: toToolArguments(
              input.tools?.find((tool) => tool.name === call.functionName)?.parameters,
              call.params
            )
          })),
          usage: { inputTokens: state.sequence.contextTokens.length - outputTokens, outputTokens }
        }
      } catch (error) {
        throw isContextOverflow(error) ? contextOverflowError(state.sequence.contextSize) : error
      } finally {
        chat.dispose({ disposeSequence: false })
      }
    })
    queue = run.catch(() => undefined)
    return run
  }
}
