import { loggerService } from '@logger'
import type { ClaudePreflightResult } from '@shared/ipc/schemas/codeCli'

const logger = loggerService.withContext('ClaudeCodePreflight')
const PREFLIGHT_TIMEOUT_MS = 15_000
const MODEL_ERROR_PATTERN = /\bmodel\b.*\b(access|available|exist|found|invalid|mapping|permission|support|unknown)\b/i

export interface ClaudePreflightInput {
  baseUrl: string
  apiKey: string
  model: string
}

function buildMessagesUrl(baseUrl: string): string {
  const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, '')}/`
  return new URL('v1/messages', normalizedBaseUrl).toString()
}

async function responseMentionsModel(response: Response): Promise<boolean> {
  try {
    const body = await response.text()
    return MODEL_ERROR_PATTERN.test(body)
  } catch {
    return false
  }
}

export async function preflightClaudeEndpoint(
  input: ClaudePreflightInput,
  fetchImpl: typeof fetch = fetch
): Promise<ClaudePreflightResult> {
  try {
    const response = await fetchImpl(buildMessagesUrl(input.baseUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with one character.' }]
      }),
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS)
    })
    const statusCode = response.status
    logger.info('Claude Code endpoint preflight completed', { statusCode })

    if (response.ok) return { success: true, category: 'ok', statusCode }
    if (statusCode === 401 || statusCode === 403) {
      return { success: false, category: 'authentication', statusCode }
    }
    if (await responseMentionsModel(response)) {
      return { success: false, category: 'model', statusCode }
    }
    if (statusCode === 404 || statusCode === 405) {
      return { success: false, category: 'route', statusCode }
    }
    return { success: false, category: 'service', statusCode }
  } catch {
    logger.warn('Claude Code endpoint preflight failed before receiving an HTTP status')
    return { success: false, category: 'service', statusCode: null }
  }
}
