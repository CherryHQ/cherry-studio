/** Directory holding workers, CMaps and fonts, or null when the bundle was loaded without a URL (inline or blob). */
export function resolveResourceBase(baseUrl?: string): string | null {
  if (baseUrl) return new URL(baseUrl, document.baseURI).href
  try {
    return new URL(/* @vite-ignore */ './assets/', import.meta.url).href
  } catch {
    return null
  }
}
