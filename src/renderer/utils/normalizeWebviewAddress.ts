const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i
const HOST_PORT_PATTERN = /^(?:\[[^\]]+\]|[^:/?#\s]+):\d+(?:[/?#]|$)/
const LOCAL_ADDRESS_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:[/?#]|$)/i
const ALLOWED_PROTOCOLS = new Set(['file:', 'http:', 'https:'])

export function normalizeWebviewAddress(value: string): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) return null

  const candidate = LOCAL_ADDRESS_PATTERN.test(trimmedValue)
    ? `http://${trimmedValue}`
    : URL_SCHEME_PATTERN.test(trimmedValue) && !HOST_PORT_PATTERN.test(trimmedValue)
      ? trimmedValue
      : `https://${trimmedValue}`

  try {
    const url = new URL(candidate)
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
