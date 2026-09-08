import type { FetchFunction } from '@ai-sdk/provider-utils'
import { Agent } from 'undici'

// Cold model loading can exceed undici's default 300-second response timeout.
const dispatcher = new Agent({ headersTimeout: 15 * 60_000, bodyTimeout: 15 * 60_000 })
const longRunningFetch: FetchFunction = (url, init) => fetch(url, { ...init, ...{ dispatcher } })

/** Chromium's injected proxy-aware fetch owns its network stack; undici is only the standalone fallback. */
export function resolveOllamaImageFetch(injected: FetchFunction | undefined): FetchFunction {
  return injected ?? longRunningFetch
}
