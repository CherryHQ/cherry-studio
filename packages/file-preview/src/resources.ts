export const defaultResourceBase = new URL(/* @vite-ignore */ './assets/', import.meta.url).href

export function resolveResourceBase(baseUrl?: string): string {
  return baseUrl ? new URL(baseUrl, document.baseURI).href : defaultResourceBase
}
