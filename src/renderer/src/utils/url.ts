export function getUrlOriginOrFallback(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
