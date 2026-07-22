import type { TokenDialect } from './dialect'
import {
  anthropicImageTokens,
  geminiImageTokens,
  type ImageDims,
  type ImageTokensFn,
  ollamaImageTokens,
  openaiImageTokens
} from './imageTokens'
import { loadGptO200kTokenizer, type TextTokenizer, tokenxTokenizer } from './textTokenizer'

/**
 * Per-dialect token-estimation strategies, colocated so adding a dialect (or swapping a
 * strategy) is a one-row edit. `satisfies Record<TokenDialect, …>` makes a missing dialect
 * a compile error.
 *
 * Anthropic remote count (the exact path for that dialect) lives in the gateway front-end
 * (`estimateAnthropicRequestTokens`), which has the request body + credentials — not here.
 */
export interface DialectProfile {
  /** Text tokenizer loader: real BPE for openai (lazy — ~2.2 MB ranks); `tokenx` heuristic elsewhere. */
  text: () => TextTokenizer | Promise<TextTokenizer>
  /** Vision-image token cost as a per-dialect formula; dimensioned when sharp reads the bytes, else a constant. */
  imageTokens: ImageTokensFn
}

const PROFILES = {
  anthropic: { text: () => tokenxTokenizer, imageTokens: anthropicImageTokens },
  openai: { text: loadGptO200kTokenizer, imageTokens: openaiImageTokens },
  google: { text: () => tokenxTokenizer, imageTokens: geminiImageTokens },
  ollama: { text: () => tokenxTokenizer, imageTokens: ollamaImageTokens }
} satisfies Record<TokenDialect, DialectProfile>

export async function getTextTokenizer(dialect: TokenDialect): Promise<TextTokenizer> {
  return PROFILES[dialect].text()
}

export function imageTokensFor(dialect: TokenDialect, dims?: ImageDims): number {
  return PROFILES[dialect].imageTokens(dims)
}
