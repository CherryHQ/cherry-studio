/**
 * Whether a string parses as an absolute `http(s)` URL.
 *
 * Lives in `shared` because both sides of the web-lookup contract have to agree
 * on it: the tool input schema the model is validated against
 * (`webFetchInputSchema`) and the service-level guard that rejects bad input at
 * fetch time (`normalizeWebSearchUrls`). When those two disagree, a URL the
 * schema lets through surfaces as a generic fetch failure instead of the
 * actionable input error it is.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
