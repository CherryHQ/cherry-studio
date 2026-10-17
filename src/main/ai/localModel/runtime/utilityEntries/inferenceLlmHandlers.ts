import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type * as NodeLlamaCpp from 'node-llama-cpp'
import type { ChatHistoryItem, ChatWrapper, Llama, LlamaContextSequence, LlamaModel } from 'node-llama-cpp'

import type {
  LlmChatMessage,
  LlmGenerateResult,
  LlmInferenceContract,
  LlmInitData
} from '@main/ai/localModel/capabilities/llm/protocol'
import type {
  UtilityProcessHandlers,
  UtilityProcessLogger
} from '@main/core/utilityProcess/runtime/serveUtilityProcess'

interface LoadedModel {
  modelPath: string
  model: LlamaModel
  sequence: LlamaContextSequence
  /** Keyed by whether thinking is enabled. */
  chatWrappers: Map<boolean, ChatWrapper>
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
  functionCalls: 'other',
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
  loaded = { modelPath, model, sequence: llamaContext.getSequence(), chatWrappers: new Map() }
  return loaded
}

function chatWrapperFor(state: LoadedModel, thinking: boolean): ChatWrapper {
  let wrapper = state.chatWrappers.get(thinking)
  if (!wrapper) {
    // Keeps the wrapper settings matched from the model's Jinja template; only thinking is overridden.
    wrapper = runtime!.resolveChatWrapper(state.model, {
      customWrapperSettings: { qwen: { thoughts: thinking ? 'auto' : 'discourage' } }
    })
    state.chatWrappers.set(thinking, wrapper)
  }
  return wrapper
}

function toChatHistory(messages: LlmChatMessage[]): ChatHistoryItem[] {
  const history = messages.map((message): ChatHistoryItem => {
    if (message.role === 'assistant') return { type: 'model', response: [message.text] }
    return { type: message.role, text: message.text }
  })
  // LlamaChat completes the trailing model item, so a new reply starts from an empty one.
  history.push({ type: 'model', response: [] })
  return history
}

export const llmHandlers: UtilityProcessHandlers<LlmInferenceContract> = {
  generate(input, { signal, emit }) {
    const run = queue.then(async (): Promise<LlmGenerateResult> => {
      signal.throwIfAborted()
      const state = await loadModel(input.modelPath, input.runtime.maxContextSize)
      signal.throwIfAborted()
      const sampling = { ...input.runtime.sampling, ...input.sampling }
      const chat = new runtime!.LlamaChat({
        contextSequence: state.sequence,
        chatWrapper: chatWrapperFor(state, input.thinking)
      })
      let outputTokens = 0
      try {
        const result = await chat.generateResponse(toChatHistory(input.messages), {
          signal,
          stopOnAbortSignal: true,
          maxTokens: input.maxOutputTokens,
          temperature: sampling.temperature,
          topP: sampling.topP,
          topK: sampling.topK,
          repeatPenalty: { presencePenalty: sampling.presencePenalty },
          onResponseChunk: (chunk) => {
            outputTokens += chunk.tokens.length
            if (chunk.text) emit({ type: chunk.type === 'segment' ? 'reasoning' : 'text', delta: chunk.text })
          }
        })
        return {
          finishReason: FINISH_REASONS[result.metadata.stopReason],
          usage: { inputTokens: state.sequence.contextTokens.length - outputTokens, outputTokens }
        }
      } finally {
        chat.dispose({ disposeSequence: false })
      }
    })
    queue = run.catch(() => undefined)
    return run
  }
}
