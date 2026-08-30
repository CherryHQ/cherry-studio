import type {
  WebSearchBudgetReason,
  WebSearchContentBudget,
  WebSearchExecutionConfig,
  WebSearchResponse,
  WebSearchResult,
  WebSearchResultBudget
} from '@shared/data/types/webSearch'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'
import { estimateTokenCount, sliceByTokens } from 'tokenx'

// The UTF-8 ceiling prevents highly compressible or adversarial text from growing without bound.
// It scales with the shared budget and also has an absolute aggregate cap.
const MAX_UTF8_BYTES_PER_BUDGET_TOKEN = 8
const ABSOLUTE_UTF8_BYTE_LIMIT = 400_000

type BudgetTokenizer = {
  count: (content: string) => number
  truncate: (content: string, tokenLimit: number) => string
}

let budgetTokenizerPromise: Promise<BudgetTokenizer> | undefined

function loadBudgetTokenizer(): Promise<BudgetTokenizer> {
  // The search service is model-agnostic, so use the stricter result from the existing heuristic
  // and both OpenAI reference encodings. Keeping these imports lazy avoids main-process startup cost.
  budgetTokenizerPromise ??= Promise.all([
    import('gpt-tokenizer/encoding/o200k_base'),
    import('gpt-tokenizer/encoding/cl100k_base')
  ])
    .then(([o200k, cl100k]) => {
      const options = { disallowedSpecial: new Set<string>() }
      const countEncoding = (encodeGenerator: typeof o200k.encodeGenerator, content: string) => {
        let count = 0
        for (const tokens of encodeGenerator(content, options)) {
          count += tokens.length
        }
        return count
      }

      return {
        count: (content: string) =>
          Math.max(
            estimateTokenCount(content),
            countEncoding(o200k.encodeGenerator, content),
            countEncoding(cl100k.encodeGenerator, content)
          ),
        truncate: (content: string, tokenLimit: number) => {
          const heuristicCandidate = trimTrailingUnpairedSurrogate(sliceByTokens(content, 0, tokenLimit))
          const o200kCandidate = o200k.decode(o200k.encode(content, options).slice(0, tokenLimit))
          const cl100kCandidate = cl100k.decode(cl100k.encode(content, options).slice(0, tokenLimit))
          const candidates = [heuristicCandidate, o200kCandidate, cl100kCandidate].filter((candidate) =>
            content.startsWith(candidate)
          )
          return candidates.reduce((shortest, candidate) => (candidate.length < shortest.length ? candidate : shortest))
        }
      }
    })
    .catch(() => {
      budgetTokenizerPromise = undefined
      // Every token in the supported BPE families represents at least one source byte. Counting
      // UTF-8 bytes is deliberately conservative, but remains a hard upper bound when the reference
      // tokenizers are unavailable; the heuristic alone can undercount adversarial low-delimiter text.
      return {
        count: utf8ByteLength,
        truncate: (content, tokenLimit) => sliceByUtf8Bytes(content, tokenLimit)
      }
    })

  return budgetTokenizerPromise
}

function utf8ByteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8')
}

function sliceByUtf8Bytes(content: string, limit: number): string {
  const bytes = Buffer.from(content, 'utf8')
  if (bytes.length <= limit) {
    return content
  }

  const decoder = new TextDecoder('utf-8', { fatal: true })
  let end = limit
  while (end > 0) {
    try {
      return decoder.decode(bytes.subarray(0, end))
    } catch (error) {
      if (
        !(error instanceof TypeError) ||
        (error as NodeJS.ErrnoException).code !== 'ERR_ENCODING_INVALID_ENCODED_DATA'
      ) {
        throw error
      }
      end -= 1
    }
  }

  return ''
}

function trimTrailingUnpairedSurrogate(content: string): string {
  if (content.length === 0) {
    return content
  }

  const lastCodeUnit = content.charCodeAt(content.length - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    return content.slice(0, -1)
  }

  const previousCodeUnit = content.length > 1 ? content.charCodeAt(content.length - 2) : undefined
  return lastCodeUnit >= 0xdc00 &&
    lastCodeUnit <= 0xdfff &&
    !(previousCodeUnit && previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff)
    ? content.slice(0, -1)
    : content
}

export type WebSearchPostProcessingResult = {
  response: WebSearchResponse
}

/**
 * Applies result-level post processing after provider execution and blacklist filtering.
 *
 * This module intentionally stays pure: it only transforms the response from
 * compression config. Request lifecycle behavior is orchestrated by
 * `WebSearchService`.
 *
 * `cutoff` keeps the configured shared budget behavior. `none` keeps content
 * untouched while it is safe, but the same limit becomes a final hard guard
 * once the model-bound payload exceeds it.
 */
export async function postProcessWebSearchResponse(
  response: WebSearchResponse,
  runtimeConfig: WebSearchExecutionConfig
): Promise<WebSearchPostProcessingResult> {
  if (response.results.length <= 0) {
    return { response }
  }

  const tokenLimit = Math.max(1, Math.floor(normalizeWebSearchCutoffLimit(runtimeConfig.compression.cutoffLimit)))
  const byteLimit = Math.min(ABSOLUTE_UTF8_BYTE_LIMIT, tokenLimit * MAX_UTF8_BYTES_PER_BUDGET_TOKEN)
  const originalBytes = response.results.reduce((total, result) => total + utf8ByteLength(result.content), 0)
  const tokenizer = await loadBudgetTokenizer()
  const originalTokenCounts = response.results.map((result) => tokenizer.count(result.content))
  const originalTokens = originalTokenCounts.reduce((total, count) => total + count, 0)
  const hardLimitExceeded = originalTokens > tokenLimit || originalBytes > byteLimit

  if (runtimeConfig.compression.method !== 'cutoff' && !hardLimitExceeded) {
    return { response }
  }

  const reason: WebSearchBudgetReason =
    runtimeConfig.compression.method === 'cutoff' ? 'configured_cutoff' : 'hard_limit'
  const processed = applyContentBudget(response.results, tokenLimit, byteLimit, reason, tokenizer, originalTokenCounts)

  if (!processed.budget) {
    return { response }
  }

  return {
    response: {
      ...response,
      results: processed.results,
      budget: processed.budget
    }
  }
}

function distributeSharedLimit(limit: number, resultCount: number): number[] {
  const base = Math.floor(limit / resultCount)
  const remainder = limit % resultCount
  return Array.from({ length: resultCount }, (_, index) => base + (index < remainder ? 1 : 0))
}

function sliceToBudget(content: string, tokenLimit: number, byteLimit: number, tokenizer: BudgetTokenizer): string {
  const byteBounded = sliceByUtf8Bytes(content, byteLimit)
  const tokenBounded = trimTrailingUnpairedSurrogate(tokenizer.truncate(byteBounded, tokenLimit))
  if (tokenizer.count(tokenBounded) <= tokenLimit) {
    return tokenBounded
  }

  // Re-encoding a decoded token prefix can occasionally merge differently. A byte-length fallback
  // is monotonic and fail-closed, unlike binary-searching a non-monotonic BPE prefix count.
  return sliceByUtf8Bytes(tokenBounded, tokenLimit)
}

function applyContentBudget(
  results: WebSearchResult[],
  tokenLimit: number,
  byteLimit: number,
  reason: WebSearchBudgetReason,
  tokenizer: BudgetTokenizer,
  originalTokenCounts: number[]
): { results: WebSearchResult[]; budget?: WebSearchContentBudget } {
  const tokenAllocations = distributeSharedLimit(tokenLimit, results.length)
  const byteAllocations = distributeSharedLimit(byteLimit, results.length)
  const processed = results.map((result, index) => {
    const originalTokens = originalTokenCounts[index]
    const content = sliceToBudget(result.content, tokenAllocations[index], byteAllocations[index], tokenizer)
    const retainedTokens = tokenizer.count(content)
    const status: WebSearchResultBudget['status'] =
      content.length === result.content.length ? 'retained' : content.length === 0 ? 'omitted' : 'truncated'
    const metrics = {
      originalTokens,
      retainedTokens,
      originalBytes: utf8ByteLength(result.content),
      retainedBytes: utf8ByteLength(content)
    }
    const budget: WebSearchResultBudget =
      status === 'retained' ? { status, ...metrics } : { status, reason, ...metrics }

    return {
      result: {
        ...result,
        content
      },
      budget
    }
  })

  if (processed.every(({ budget }) => budget.status === 'retained')) {
    return { results }
  }

  const budget: WebSearchContentBudget = {
    reason,
    tokenLimit,
    byteLimit,
    originalTokens: processed.reduce((total, item) => total + item.budget.originalTokens, 0),
    retainedTokens: processed.reduce((total, item) => total + item.budget.retainedTokens, 0),
    originalBytes: processed.reduce((total, item) => total + item.budget.originalBytes, 0),
    retainedBytes: processed.reduce((total, item) => total + item.budget.retainedBytes, 0)
  }

  return {
    results: processed.map(({ result, budget: resultBudget }) => ({ ...result, budget: resultBudget })),
    budget
  }
}
