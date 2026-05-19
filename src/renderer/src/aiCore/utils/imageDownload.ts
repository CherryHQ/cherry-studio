/**
 * Painting-side image-result plumbing (R1 shared infra).
 *
 * The patched `ai` `generateImage` auto-downloads any `http(s)` image string
 * via a renderer `fetch` unless a custom `experimental_download` is supplied.
 * For painting we do NOT want that: bespoke painting downloads image URLs
 * through the main-process, proxy-aware `window.api.file.download`
 * (`paintings/utils/downloadImages.ts`) with per-URL partial success, the
 * empty-URL toast, `showProxyWarning`, and `allowBase64DataUrls`.
 *
 * So painting passes {@link passthroughImageDownload} — a `DownloadFunction`
 * that returns `null` for every requested URL. The patched SDK then skips the
 * download and stores the original URL string verbatim as the
 * `GeneratedFile`'s `base64` value. {@link classifyImageOutput} recovers it:
 * an `http(s)://` value is a pass-through URL (hand back to the painting
 * downloader); anything else is real base64 bytes (with a defensive strip of
 * a redundant `data:<mediaType>;base64,` prefix some transports emit).
 */

/** Structural shape of the `ai` SDK `DownloadFunction` (not exported by `ai`). */
export type ImageDownloadFunction = (
  options: Array<{ url: URL; isUrlSupportedByModel: boolean }>
) => Promise<Array<{ data: Uint8Array; mediaType: string | undefined } | null>>

/**
 * Pass-through download: never downloads. Returning `null` per item tells the
 * patched SDK to keep the original URL string instead of fetching it, so the
 * painting layer can download it through the main process.
 */
export const passthroughImageDownload: ImageDownloadFunction = (options) => Promise.resolve(options.map(() => null))

export type ClassifiedImage = { type: 'url'; url: string } | { type: 'base64'; base64: string }

const DATA_URL_BASE64_PREFIX = /^data:[^;,]*;base64,/

/**
 * Classify one `GeneratedFile.base64` value produced under
 * {@link passthroughImageDownload}:
 *
 * - `http://` / `https://` → a pass-through remote URL.
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
