import { APICallError } from 'ai'
import { isErrorAttempt, type LanguageModel, type Retryable } from 'ai-retry'
import { isPlainObject } from 'es-toolkit'

import { getTerminalModelError } from '../../../utils/retryError'

export const MAX_OUTPUT_TOKEN_RETRIES = 3
const MAX_ERROR_LENGTH = 16 * 1024
const OUTPUT_TOKEN_KEYS = ['max_tokens', 'max_completion_tokens', 'max_output_tokens', 'maxOutputTokens']
const OUTPUT_TOKEN_NAME = /\b(?:max_(?:completion_|output_)?tokens|MaxTokens|maxOutputTokens|max output tokens)\b/i
const CEILING_PATTERNS = [
  /^(?:value,\s*the valid range of max_tokens is|invalid,\s*should be in|should be|参数非法：限制数值范围)\s*\[\s*\d+\s*,\s*(\d+)\s*\]/i,
  /^must be between \d+ and (\d+)/i,
  /^(?:must be at most|is too large:\s*\d+\.\s*This model supports at most)\s+(\d+)/i,
  /^(?:must be less than or equal to|\(\d+\):\s*Input should be less than or equal to|is limited to|\d+ exceeds this model's maximum output of|specified in the request are not valid:\s*integer above maximum value,\s*expected a value\s*<=)\s*[\x60'"]?(\d+)/i,
  /^=\s*\d+\s+cannot be greater than (?:max_model_len=max_total_tokens=)?(\d+)/i,
  /^:\s*\d+\s*>\s*(\d+),\s*which is the maximum allowed number of output tokens/i
]
const EXCLUSIVE_RANGE = /^value of \d+ but the supported range is from \d+ \(inclusive\) to (\d+) \(exclusive\)/i
const TOO_LARGE = /^(?:is too large\b|exceeds? the model's context limit\b)/i

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function lowerBudget(errorBody: string, current: number, fallbackMessage: string): number | undefined {
  const json = parseJson(errorBody)
  const error = isPlainObject(json) ? (json.error ?? json) : (json ?? errorBody)
  const messages = isPlainObject(error) ? [error.message, error.param, fallbackMessage] : [error, fallbackMessage]
  let explicitOverflow = false
  for (const message of messages) {
    if (typeof message !== 'string') continue
    const field = OUTPUT_TOKEN_NAME.exec(message)
    if (!field) continue
    const detail = message
      .slice(field.index + field[0].length)
      .replace(/^[\x60'"]/, '')
      .trimStart()
    const exclusive = EXCLUSIVE_RANGE.exec(detail)
    const inclusive = CEILING_PATTERNS.map((pattern) => pattern.exec(detail)).find(Boolean)
    if (exclusive || inclusive) {
      const ceiling = exclusive ? Number(exclusive[1]) - 1 : Number(inclusive?.[1])
      return Number.isSafeInteger(ceiling) && ceiling > 0 && ceiling < current ? ceiling : undefined
    }
    explicitOverflow ||= TOO_LARGE.test(detail)
  }
  return explicitOverflow && current > 1 ? Math.floor(current / 2) : undefined
}

export function outputTokenRetry(maxRetries: number): Retryable<LanguageModel> {
  return ({ current }) => {
    if (!isErrorAttempt(current) || current.options.abortSignal?.aborted) return
    const error = getTerminalModelError(current.error)
    if (!APICallError.isInstance(error) || (error.statusCode !== 400 && error.statusCode !== 422)) return
    const body = error.requestBodyValues
    if (!isPlainObject(body)) return
    if (body.max_completion_tokens != null && current.options.providerOptions?.openai?.maxCompletionTokens != null) {
      return
    }

    const requested = OUTPUT_TOKEN_KEYS.map((key) => body[key]).filter((value) => value != null)
    if (isPlainObject(body.generationConfig) && body.generationConfig.maxOutputTokens != null) {
      requested.push(body.generationConfig.maxOutputTokens)
    }
    const [wireBudget] = requested
    const budget = current.options.maxOutputTokens
    const thinkingBudget =
      isPlainObject(body.thinking) && typeof body.thinking.budget_tokens === 'number' ? body.thinking.budget_tokens : 0
    // Replay only when changing the SDK option can lower the rejected request.
    if (
      requested.length !== 1 ||
      budget === undefined ||
      !Number.isSafeInteger(budget) ||
      typeof wireBudget !== 'number' ||
      wireBudget !== budget + thinkingBudget
    )
      return

    const next = lowerBudget((error.responseBody ?? '').slice(0, MAX_ERROR_LENGTH), wireBudget, error.message)
    if (next === undefined || next <= thinkingBudget) return
    return {
      model: current.model,
      options: { ...current.options, maxOutputTokens: next - thinkingBudget },
      maxAttempts: maxRetries + 1
    }
  }
}
