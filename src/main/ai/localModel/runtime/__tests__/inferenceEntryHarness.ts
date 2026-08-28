import type { AsrInferenceContract, EmbeddingInferenceContract, OcrInferenceContract } from '../inferenceProcess'
import type { InferenceInitData } from '../protocol'

/**
 * Runs the inference entry handlers in-process, the way a real utility process runs
 * them: one shared runtime module (so the CPU fallback is sticky across both), init data
 * applied once, and a logger that records what the child would have relayed to the host.
 *
 * `vi.resetModules()` before each load is what gives every test a fresh process: the
 * runtime keeps its loaded packages, profile and cached models in module state.
 */

export interface EmbeddingHandlers {
  embed(input: EmbeddingInferenceContract['methods']['embed']['input']): Promise<number[][]>
  countTokens(input: EmbeddingInferenceContract['methods']['countTokens']['input']): Promise<number[]>
}

export interface OcrHandlers {
  recognize(
    input: OcrInferenceContract['methods']['recognize']['input']
  ): Promise<OcrInferenceContract['methods']['recognize']['output']>
}

export interface AsrHandlers {
  transcribe(
    input: AsrInferenceContract['methods']['transcribe']['input']
  ): Promise<AsrInferenceContract['methods']['transcribe']['output']>
}

export interface LoadedInferenceEntries {
  embedding: EmbeddingHandlers
  ocr: OcrHandlers
  asr: AsrHandlers
  /** `level: message` lines, in order. */
  logs: string[]
}

export async function loadInferenceEntries(initData: InferenceInitData): Promise<LoadedInferenceEntries> {
  const { vi } = await import('vitest')
  vi.resetModules()

  const logs: string[] = []
  const record =
    (level: string) =>
    (message: string): void => {
      logs.push(`${level}: ${message}`)
    }
  const logger = { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') }

  const runtime = await import('../utilityEntries/inferenceRuntime')
  const { embeddingHandlers } = await import('../utilityEntries/inferenceEmbeddingHandlers')
  const { ocrHandlers } = await import('../utilityEntries/inferenceOcrHandlers')
  const { asrHandlers } = await import('../utilityEntries/inferenceAsrHandlers')
  runtime.applyInitData(initData)

  const context = <Event>(emit: (event: Event) => void = () => {}) => ({
    signal: new AbortController().signal,
    emit,
    logger
  })

  return {
    logs,
    embedding: {
      embed: async (input) => embeddingHandlers.embed(input, context()),
      countTokens: async (input) => embeddingHandlers.countTokens(input, context())
    },
    ocr: {
      recognize: async (input) => ocrHandlers.recognize(input, context())
    },
    asr: {
      transcribe: async (input) => asrHandlers.transcribe(input, context())
    }
  }
}
