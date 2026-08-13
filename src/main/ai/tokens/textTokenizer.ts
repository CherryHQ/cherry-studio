import { estimateTokenCount } from 'tokenx'

/**
 * Pluggable text token counter. `tokenx` is the dialect-agnostic heuristic; the openai
 * dialect uses a real BPE tokenizer. `profiles.ts` holds the per-dialect dispatch, so
 * swapping a tokenizer never touches consumers.
 */
export interface TextTokenizer {
  readonly id: string
  count(text: string): number
}

/** Heuristic tokenizer — `tokenx` character approximation. Used where no exact BPE fits. */
export const tokenxTokenizer: TextTokenizer = {
  id: 'tokenx',
  count: (text) => (text ? estimateTokenCount(text) : 0)
}

let o200k: TextTokenizer | undefined

/**
 * Real BPE tokenizer for the openai dialect — `o200k_base`, the encoding GPT-5 / gpt-4o /
 * gpt-4.1 / o-series use (openai-compatible relays like deepseek/qwen route here too — an
 * approximation, but far closer than the heuristic). Loaded lazily: the ranks module is
 * ~2.2 MB, so it must not ride the main-process startup import chain.
 */
export async function loadGptO200kTokenizer(): Promise<TextTokenizer> {
  if (!o200k) {
    const { countTokens } = await import('gpt-tokenizer/encoding/o200k_base')
    o200k = { id: 'gpt-tokenizer/o200k', count: (text) => (text ? countTokens(text) : 0) }
  }
  return o200k
}
