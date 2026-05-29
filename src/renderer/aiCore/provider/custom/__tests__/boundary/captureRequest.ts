import { vi } from 'vitest'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../../imageGenerationModel'

export interface CapturedRequest {
  url: string
  method: string
  /** JSON bodies are parsed; FormData is normalized to a plain inspectable record. */
  body: unknown
}

function normalizeBody(raw: BodyInit | null | undefined): unknown {
  if (raw == null) return undefined
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw instanceof FormData) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of raw.entries()) {
      const value = v instanceof Blob ? `<Blob ${v.type} ${v.size}b>` : v
      // repeated keys (e.g. multi-image `image`) collapse into an array
      if (k in out) out[k] = [...(Array.isArray(out[k]) ? (out[k] as unknown[]) : [out[k]]), value]
      else out[k] = value
    }
    return out
  }
  return raw
}

/**
 * Drive an `ImageGenerationTransport` at its outbound boundary: mock `fetch`,
 * run `submit`, and return the single captured request (url + normalized body).
 *
 * The canned `{}` 200 response is lenient enough that every transport's
 * response parser yields no urls *without throwing*, so `submit` always
 * completes regardless of family — we only care about what went out.
 */
export async function captureImageRequest(
  transport: ImageGenerationTransport,
  input: ImageGenerationSubmitInput
): Promise<CapturedRequest> {
  let captured: { url: string; init?: RequestInit } | undefined
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(((url: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(url), init }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof fetch)

  try {
    await transport.submit(input)
  } finally {
    fetchMock.mockRestore()
  }

  if (!captured) throw new Error('transport did not call fetch')
  return {
    url: captured.url,
    method: captured.init?.method ?? 'GET',
    body: normalizeBody(captured.init?.body)
  }
}
