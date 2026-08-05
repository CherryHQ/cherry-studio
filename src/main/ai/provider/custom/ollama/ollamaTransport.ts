import { combineHeaders, createJsonResponseHandler, type FetchFunction, postJsonToApi } from '@ai-sdk/provider-utils'
import type { WireVendorBag } from '@main/ai/utils/imageOptions'
import { Agent } from 'undici'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../imageTransport'
import {
  completedImageTransportSubmission,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler } from '../imageTransportHttp'

/**
 * Ollama single-shot image transport. POSTs `${baseURL}/generate` — the same
 * `/api/generate` endpoint Ollama uses for text completion, just pointed at an
 * image model id (e.g. `x/z-image-turbo`) — and reads the base64 `image` field
 * back synchronously, so this transport only implements `submit()`.
 *
 * `width`/`height` (from `size`) and `steps` (from `providerParams`, mapped in
 * `imageOptions.ts`) are top-level `GenerateRequest` fields; `seed` is not —
 * it must nest under `options.seed` (the same sampling-options bag the LLM
 * generate path uses), confirmed by A/B testing identical requests: a
 * top-level `seed` produced a different image each call, `options.seed`
 * reproduced the same one.
 */

// Cold-loading a multi-GB image model (e.g. x/z-image-turbo, ~12.7GB) before it
// can even start generating routinely exceeds undici's default 300s fetch
// timeout, which surfaces as an opaque "fetch failed" — give this transport a
// longer one. Module-level singleton so repeated calls reuse the connection pool.
// Only applies to the global-fetch fallback below: an injected `fetch` (e.g.
// Electron's proxy-aware `customFetch`, wired in via `ollamaProvider.ts`) rides
// on Chromium's network stack, which has no analogous default timeout to trip.
const IMAGE_GENERATION_TIMEOUT_MS = 15 * 60 * 1000
const longRunningDispatcher = new Agent({
  headersTimeout: IMAGE_GENERATION_TIMEOUT_MS,
  bodyTimeout: IMAGE_GENERATION_TIMEOUT_MS
})
const ollamaImageResponseSchema = z.object({ image: z.string().min(1) }).passthrough()
const longRunningFetch: FetchFunction = (url, init) =>
  fetch(url, { ...init, dispatcher: longRunningDispatcher } as RequestInit)

export interface OllamaTransportSettings {
  /** Already carries the `/api` suffix, matching `ollama-ai-provider-v2`'s own baseURL convention. */
  baseURL: string
  headers?: Record<string, string>
  /** Caller-injected fetch (e.g. the proxy-aware `customFetch`); falls back to global `fetch` when unset. */
  fetch?: FetchFunction
}

class OllamaTransport implements ImmediateImageGenerationTransport<WireVendorBag> {
  private readonly baseURL: string
  private readonly headers: Record<string, string>
  private readonly fetch: FetchFunction

  readonly task = { kind: 'unsupported' as const }

  constructor(settings: OllamaTransportSettings) {
    this.baseURL = settings.baseURL
    this.headers = settings.headers ?? {}
    this.fetch = settings.fetch ?? longRunningFetch
  }

  /** `/api/generate` takes a prompt only — Ollama's image models are text-to-image. */
  supportsInput(): ImageTransportInputSupport {
    return { files: false, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<WireVendorBag>) {
    const [width, height] = input.size?.split('x').map(Number) ?? []
    const steps = input.providerParams.steps
    const response = await postJsonToApi({
      url: `${this.baseURL}/generate`,
      headers: combineHeaders(this.headers, input.headers),
      body: {
        model: input.modelId,
        prompt: input.prompt ?? '',
        stream: false,
        ...(width !== undefined && height !== undefined && { width, height }),
        ...(typeof steps === 'number' && { steps }),
        ...(input.seed !== undefined && { options: { seed: input.seed } })
      },
      abortSignal: input.signal,
      fetch: this.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(ollamaImageResponseSchema)
    })
    // Return the bare base64 payload, not a `data:` URI: the patched `ai` SDK's
    // generateImage() only auto-downloads strings starting with `http(s)://`;
    // anything else is passed straight through as `GeneratedFile.data` verbatim
    // and later base64-decoded as-is, so a `data:image/png;base64,` prefix here
    // would corrupt the decode with non-base64 characters (`:`, `;`, `,`).
    return completedImageTransportSubmission([response.value.image], 'Ollama')
  }
}

export function createOllamaTransport(settings: OllamaTransportSettings): OllamaTransport {
  return new OllamaTransport(settings)
}

export type { OllamaTransport }
