const BEARER_TOKEN_PATTERN = /\bBearer\s+\S+/gi

// Triple-quoted alternatives must come before the single-quote-pair alternative — otherwise that
// alternative matches only up to the first quote inside the triple-quoted block, leaving the rest
// of a multiline TOML secret unredacted.
const SENSITIVE_MESSAGE_PATTERN =
  /(["']?(?:api[_-]?key|token|secret|password|auth)\w*["']?\s*[:=]\s*)("""[\s\S]*?"""|'''[\s\S]*?'''|["'][^"']*["']|\S+)/gi

/** Redact likely-sensitive key=value / "key": value / Bearer-token fragments embedded in a raw parser error message. */
export function redactSecretsInMessage(message: string): string {
  // Bearer must be redacted before the key=value pass, which would otherwise consume the literal
  // word "Bearer" as the "value" for a preceding "Authorization:" key and leave the real token intact.
  return message.replace(BEARER_TOKEN_PATTERN, 'Bearer <redacted>').replace(SENSITIVE_MESSAGE_PATTERN, '$1"<redacted>"')
}
