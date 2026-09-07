const MAX_UPDATE_ERROR_MESSAGE_LENGTH = 64 * 1024

/** Recognize the managed feed's missing-manifest response without exposing its HTTP body. */
export function isMissingUpdateManifest(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('message' in error)) return false
  const message = error.message
  if (typeof message !== 'string' || message.length > MAX_UPDATE_ERROR_MESSAGE_LENGTH) return false
  if (!message.startsWith('503 ')) return false

  const descriptionStart = message.indexOf('\n')
  const descriptionEnd = message.indexOf('\nHeaders: ')
  if (descriptionStart === -1 || descriptionEnd <= descriptionStart) return false

  try {
    // builder-util-runtime JSON-encodes the description in message; unlike custom
    // HttpError fields, message survives Electron's Error serialization.
    const description: unknown = JSON.parse(message.slice(descriptionStart + 1, descriptionEnd))
    if (typeof description !== 'string') return false

    const match = /^method: GET url: https:\/\/releases\.cherry-ai\.com\/[^\s]+\n\s*Data:\s*([\s\S]+)$/.exec(
      description
    )
    if (!match) return false

    const body = JSON.parse(match[1]) as { error?: { code?: unknown } } | null
    return body?.error?.code === 'manifest_missing'
  } catch {
    return false
  }
}
