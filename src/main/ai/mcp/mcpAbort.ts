import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client'

import { isAbortError } from '@main/utils/error'

/**
 * True when `error` is the cancellation outcome of `signal` aborting, not a genuine
 * transport/server failure that happened to race the abort. Cancellation evidence:
 * the signal's own reason, an AbortError raised on its behalf, or the MCP SDK's abort
 * wrapper — `Protocol.request` rejects an aborted call with
 * `SdkError(SdkErrorCode.RequestTimeout, String(signal.reason))` and no `data`.
 *
 * The code alone is NOT evidence: a genuine request timeout reuses `RequestTimeout`
 * but says 'Request timed out' and carries `{ timeout }` data, so match the wrapped
 * reason text and the data-less shape too.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- MCP operations reject arbitrary values; cancellation requires original reason identity, an AbortError, or the SDK's verified abort wrapper.
export function isMcpCancellation(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false

  if (error === signal.reason) return true

  try {
    if (isAbortError(error)) return true

    return (
      error instanceof SdkError &&
      error.code === SdkErrorCode.RequestTimeout &&
      error.data === undefined &&
      error.message.includes(String(signal.reason))
    )
  } catch {
    return false
  }
}
