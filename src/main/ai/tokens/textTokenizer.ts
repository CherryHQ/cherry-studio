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
// Work-policy cutoff in UTF-16 units, not a measured stack boundary.
const MAX_EXACT_TEXT_LENGTH = 16_384

/**
 * Real BPE tokenizer for the openai dialect — `o200k_base`, the encoding GPT-5 / gpt-4o /
 * gpt-4.1 / o-series use (openai-compatible relays like deepseek/qwen route here too — an
 * approximation, but far closer than the heuristic). Loaded lazily: the ranks module is
 * ~2.2 MB, so it must not ride the main-process startup import chain.
 */
export async function loadGptO200kTokenizer(): Promise<TextTokenizer> {
  if (!o200k) {
    const { countTokens } = await import('gpt-tokenizer/encoding/o200k_base')
    const ordinaryTextOptions = { disallowedSpecial: new Set<string>() }
    o200k = {
      id: 'gpt-tokenizer/o200k',
      // This counter estimates arbitrary user and persisted text. Special-token spellings are
      // content here, not encoder control instructions, so count them instead of rejecting them.
      count: (text) => {
        if (!text) return 0
        // Each ordinary byte-BPE token covers at least one UTF-8 byte, so bytes bound the count above.
        if (text.length > MAX_EXACT_TEXT_LENGTH) return Buffer.byteLength(text, 'utf8')
        try {
          return countTokens(text, ordinaryTextOptions)
        } catch {
          return Buffer.byteLength(text, 'utf8')
        }
      }
    }
  }
  return o200k
}
