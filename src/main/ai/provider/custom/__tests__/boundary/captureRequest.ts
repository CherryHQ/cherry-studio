import { vi } from 'vitest'

import type { Serializable } from '@shared/types/serializable'
import { SerializableSchema } from '@shared/utils/serializable'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../../imageGenerationModel'

export interface CapturedRequest {
  url: string
  method: string
  headers: Headers
  /** JSON bodies are parsed; FormData is normalized to a plain inspectable record. */
  body: ReturnType<typeof normalizeBody>
}

function normalizeBody(
  raw: BodyInit | null | undefined
): Serializable | Exclude<BodyInit, string | FormData> | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'string') return SerializableSchema.parse(JSON.parse(raw))
  if (raw instanceof FormData) {
    const out = new Map<string, string | string[]>()
    for (const [k, v] of raw.entries()) {
      const value = v instanceof Blob ? `<Blob ${v.type} ${v.size}b>` : v
      const previous = out.get(k)
      out.set(k, previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value])
    }
    return Object.fromEntries(out)
  }
  return raw
}

function makeCapturingFetch() {
  let captured: { url: string; init?: RequestInit } | undefined
  // The canned `{}` 200 response is lenient enough that every caller's response
  // parser yields nothing *without throwing* — we only care about what went out.
  const fetch = (url: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(url), init }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }

  return {
    fetch,
    wasCaptured: () => captured !== undefined,
    result(): CapturedRequest {
      if (!captured) throw new Error('no fetch request was made')
      return {
        url: captured.url,
        method: captured.init?.method ?? 'GET',
        headers: new Headers(captured.init?.headers),
        body: normalizeBody(captured.init?.body)
      }
    }
  }
}

/**
 * Capture the outbound request of a `submit`-based transport. Transports call
 * the global `fetch` directly, so the global is mocked for the call.
 */
export async function captureImageRequest(
  transport: ImageGenerationTransport,
  input: ImageGenerationSubmitInput
): Promise<CapturedRequest> {
  const cap = makeCapturingFetch()
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(cap.fetch)
  try {
    await transport.submit(input)
  } catch (err) {
    if (!cap.wasCaptured()) throw err
  } finally {
    spy.mockRestore()
  }
  return cap.result()
}

/**
 * Inbound boundary: run a `submit`-based transport against a canned vendor
 * response (global `fetch` mocked) and return the parsed `{ imageUrls | taskId }`.
 */
export async function submitWithResponse(
  transport: ImageGenerationTransport,
  input: ImageGenerationSubmitInput,
  responseBody: unknown
): Promise<{ taskId?: string; imageUrls?: string[] }> {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }))
  try {
    return await transport.submit(input)
  } finally {
    spy.mockRestore()
  }
}

/**
 * Inbound boundary for units with an injectable `fetch` (image models): the
 * caller wires the provided fetch — which returns `responseBody` — and runs.
 */
export function runWithResponse<T>(
  responseBody: unknown,
  run: (fetch: typeof globalThis.fetch) => PromiseLike<T>
): Promise<T> {
  const fetch = (() =>
    Promise.resolve(new Response(JSON.stringify(responseBody), { status: 200 }))) as typeof globalThis.fetch
  return Promise.resolve(run(fetch))
}

/**
 * Capture the outbound request when the unit accepts an *injectable* `fetch`
 * (e.g. image models that bind `config.fetch` at construction, before any
 * global mock would apply). The caller wires the provided fetch in and runs.
 */
export async function captureWithFetch<TResult>(
  run: (fetch: typeof globalThis.fetch) => TResult
): Promise<CapturedRequest> {
  const cap = makeCapturingFetch()
  try {
    await run(cap.fetch)
  } catch (err) {
    if (!cap.wasCaptured()) throw err
  }
  return cap.result()
}
