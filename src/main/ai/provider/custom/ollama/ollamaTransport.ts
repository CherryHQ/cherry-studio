import { Agent } from 'undici'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'

/**
 * Ollama single-shot image transport. POSTs `${baseURL}/generate` — the same
 * `/api/generate` endpoint Ollama uses for text completion, just pointed at an
 * image model id (e.g. `x/z-image-turbo`) — and reads the base64 `image` field
 * back synchronously, so this transport only implements `submit()`.
 *
 * `width`/`height` (from `size`), `seed`, and `steps` (from `providerParams`,
 * mapped in `imageOptions.ts`) mirror `ollama run --width --height --steps
 * --seed`, confirmed against the Ollama binary's own `json:"width"` /
 * `"height"` / `"seed"` / `"steps"` struct tags and a live `/api/generate` call.
 */

// Cold-loading a multi-GB image model (e.g. x/z-image-turbo, ~12.7GB) before it
// can even start generating routinely exceeds undici's default 300s fetch
// timeout, which surfaces as an opaque "fetch failed" — give this transport a
// longer one. Module-level singleton so repeated calls reuse the connection pool.
const IMAGE_GENERATION_TIMEOUT_MS = 15 * 60 * 1000
const longRunningDispatcher = new Agent({
  headersTimeout: IMAGE_GENERATION_TIMEOUT_MS,
  bodyTimeout: IMAGE_GENERATION_TIMEOUT_MS
})

export interface OllamaTransportSettings {
  /** Already carries the `/api` suffix, matching `ollama-ai-provider-v2`'s own baseURL convention. */
  baseURL: string
  headers?: Record<string, string>
}

class OllamaTransport implements ImageGenerationTransport {
  private baseURL: string
  private headers: Record<string, string>

  constructor(settings: OllamaTransportSettings) {
    this.baseURL = settings.baseURL
    this.headers = settings.headers ?? {}
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const [width, height] = input.size?.split('x').map(Number) ?? []
    const steps = input.providerParams.steps
    const response = await fetch(`${this.baseURL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({
        model: input.modelId,
        prompt: input.prompt ?? '',
        stream: false,
        ...(width !== undefined && height !== undefined && { width, height }),
        ...(input.seed !== undefined && { seed: input.seed }),
        ...(typeof steps === 'number' && { steps })
      }),
      signal: input.signal,
      dispatcher: longRunningDispatcher
    } as RequestInit)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      throw new Error(errorData.error || 'Image generation failed')
    }

    const data = await response.json()
    if (!data.image) {
      return { imageUrls: [] }
    }
    // Return the bare base64 payload, not a `data:` URI: the patched `ai` SDK's
    // generateImage() only auto-downloads strings starting with `http(s)://`;
    // anything else is passed straight through as `GeneratedFile.data` verbatim
    // and later base64-decoded as-is, so a `data:image/png;base64,` prefix here
    // would corrupt the decode with non-base64 characters (`:`, `;`, `,`).
    return { imageUrls: [data.image] }
  }
}

export function createOllamaTransport(settings: OllamaTransportSettings): OllamaTransport {
  return new OllamaTransport(settings)
}

export type { OllamaTransport }
