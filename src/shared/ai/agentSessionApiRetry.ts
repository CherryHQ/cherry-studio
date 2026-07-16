/**
 * Ephemeral, session-scoped status for a Claude Agent SDK `system/api_retry` event: the SDK is
 * backing off before re-issuing a failed API request. It rides shared cache (never persisted as
 * conversation content) and is cleared the moment content resumes, the turn ends, errors, is
 * cancelled, or the connection closes — mirroring the agent compaction status path.
 *
 * `errorCategory` is the SDK's safe error enum (`SDKAssistantMessageError`: 'rate_limit',
 * 'server_error', …), typed as a plain string here so `@shared` carries no SDK dependency.
 */
export interface AgentSessionApiRetryInfo {
  attempt: number
  maxRetries: number
  retryDelayMs: number
  errorStatus: number | null
  errorCategory: string
}

export type AgentSessionApiRetryState =
  | { status: 'idle' }
  | (AgentSessionApiRetryInfo & {
      status: 'retrying'
      /** When this attempt's backoff started — the renderer counts `retryDelayMs` down from here. */
      startedAt: string
    })

export const AGENT_SESSION_API_RETRY_CACHE_KEY = (sessionId: string) => `agent.session.apiRetry.${sessionId}` as const
