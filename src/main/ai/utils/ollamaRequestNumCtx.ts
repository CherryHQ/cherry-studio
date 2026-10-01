import { isIPv4 } from 'node:net'
import os from 'node:os'

import { application } from '@application'
import {
  OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY,
  resolveOllamaNumCtx,
  type ResolveOllamaNumCtxInput
} from '@shared/ai/ollamaNumCtx'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { getBaseUrl } from './provider'

export interface OllamaNumCtxResolution extends ResolveOllamaNumCtxInput {
  numCtx: number
}

/** True when Ollama is served on this machine (default host or loopback). */
export function isLocalOllamaApiHost(apiHost: string): boolean {
  const trimmed = apiHost.trim()
  if (!trimmed) return true

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true
    if (isIPv4(hostname) && Number(hostname.split('.')[0]) === 127) return true
    return false
  } catch {
    return true
  }
}

function readSessionCap(model: Model): number | null | undefined {
  try {
    const caps = application.get('CacheService').getShared(OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY)
    return caps?.[model.id]
  } catch {
    return undefined
  }
}

export function resolveOllamaRequestNumCtx(
  model: Model,
  provider?: Provider,
  preferredEndpoint?: EndpointType | null
): OllamaNumCtxResolution | undefined {
  const trainedContextWindow = model.contextWindow
  if (!trainedContextWindow || trainedContextWindow <= 0) return undefined

  const apiHost = provider != null ? getBaseUrl(provider, preferredEndpoint ?? ENDPOINT_TYPE.OLLAMA_CHAT) : ''
  const useLocalMemory = provider == null || isLocalOllamaApiHost(apiHost)

  const input: ResolveOllamaNumCtxInput = {
    trainedContextWindow,
    freeMemoryBytes: useLocalMemory ? os.freemem() : 0,
    totalMemoryBytes: useLocalMemory ? os.totalmem() : 0,
    sessionCap: readSessionCap(model)
  }
  return { ...input, numCtx: resolveOllamaNumCtx(input) }
}
