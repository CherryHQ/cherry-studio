import { net } from 'electron'
import type * as z from 'zod'

import { t } from '@main/i18n'
import { createPinnedDispatcher } from '@main/services/proxy/pinnedDispatcher'
import { resolveRemoteFetchUrl, sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'

import type { OpenMineruConnection } from './types'

export async function requestJson<T>(
  connection: OpenMineruConnection,
  endpoint: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
  body?: object
): Promise<T> {
  const response = await net.fetch(`${connection.apiHost}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    credentials: 'omit',
    signal
  })
  if (!response.ok) {
    await response.body?.cancel()
    assertSuccessful(response)
  }
  const payload: unknown = await response.json().catch(() => undefined)
  signal?.throwIfAborted()
  const result = schema.safeParse(payload)
  if (!result.success) throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  return result.data
}

export function assertSuccessful(response: Response): void {
  if (!response.ok) throw new Error(t('file_processing.errors.open_mineru_request_failed', { status: response.status }))
}

export function resolveTransferUrl(value: string, base: string, apiHost: string): string {
  try {
    return sanitizeRemoteUrl(new URL(value, base).href, apiHost)
  } catch {
    throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  }
}

export async function withTransferResponse<T>(
  connection: OpenMineruConnection,
  url: string,
  init: { method?: 'PUT'; headers: Headers; body?: Blob; signal?: AbortSignal },
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const target = await resolveRemoteFetchUrl(url, {
    signal: init.signal,
    configuredApiHost: connection.apiHost
  })
  const dispatcher = createPinnedDispatcher(target)
  let response: Response | undefined
  try {
    response = await fetch(target.url, { ...init, redirect: 'manual', ...{ dispatcher } })
    return await consume(response)
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await dispatcher.destroy()
  }
}
