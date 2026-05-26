/**
 * Painting-side image-result plumbing (R1 shared infra).
 *
 * AI SDK image models return raw base64 strings or URL strings. URL strings
 * must be converted to bytes through `experimental_download`; otherwise the
 * SDK falls through to media sniffing and treats the URL as base64.
 */

/** Structural shape of the `ai` SDK `DownloadFunction` (not exported by `ai`). */
export type ImageDownloadFunction = (
  options: Array<{ url: URL; isUrlSupportedByModel: boolean }>
) => Promise<Array<{ data: Uint8Array; mediaType: string | undefined } | null>>

/**
 * Download URL outputs before AI SDK wraps them as `GeneratedFile`.
 */
export const downloadImageUrls: ImageDownloadFunction = async (options) =>
  Promise.all(
    options.map(async ({ url }) => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
      }
      return {
        data: new Uint8Array(await response.arrayBuffer()),
        mediaType: response.headers.get('content-type') ?? undefined
      }
    })
  )

export type ClassifiedImage = { type: 'url'; url: string } | { type: 'base64'; base64: string }

const DATA_URL_BASE64_PREFIX = /^data:[^;,]*;base64,/

/**
 * Classify one `GeneratedFile.base64` value produced under
 * `generateImage`:
 *
 * - `http://` / `https://` → a defensive pass-through remote URL.
 * - `data:<mediaType>;base64,<b64>` → strip the prefix, return raw base64
 *   (prevents the double-prefix corruption when a transport already returned
 *   a data URL and `convertImageResult` would prepend another prefix).
 * - otherwise → already-raw base64.
 */
export function classifyImageOutput(value: string): ClassifiedImage {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return { type: 'url', url: value }
  }
  return { type: 'base64', base64: value.replace(DATA_URL_BASE64_PREFIX, '') }
}
