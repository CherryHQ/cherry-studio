import type { WebUiApiError } from '../types/api'

export type WebUiHttpClientOptions = {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}

export class WebUiHttpError extends Error {
  readonly status: number
  readonly payload: WebUiApiError | undefined

  constructor(status: number, payload: WebUiApiError | undefined) {
    super(payload?.message ?? `WebUI request failed with status ${status}`)
    this.name = 'WebUiHttpError'
    this.status = status
    this.payload = payload
  }
}

const DEFAULT_TIMEOUT_MS = 15_000

const isApiError = (value: unknown): value is WebUiApiError => {
  return Boolean(value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string')
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (!text) return undefined

  return JSON.parse(text) as unknown
}

export const createWebUiHttpClient = ({
  baseUrl = '',
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: WebUiHttpClientOptions = {}) => {
  let authKey = ''

  const requestJson = async <TResponse>(path: string, init: RequestInit = {}): Promise<TResponse> => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(authKey ? { 'X-Cherry-Webui-Key': authKey } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers
        },
        signal: init.signal ?? controller.signal
      })
      const payload = await readJson(response)

      if (!response.ok) {
        throw new WebUiHttpError(response.status, isApiError(payload) ? payload : undefined)
      }

      return payload as TResponse
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return {
    getJson: <TResponse>(path: string) => requestJson<TResponse>(path),
    postJson: <TResponse>(path: string, body: unknown) =>
      requestJson<TResponse>(path, {
        body: JSON.stringify(body),
        method: 'POST'
      }),
    setAuthKey: (key: string) => {
      authKey = key.trim()
    }
  }
}
