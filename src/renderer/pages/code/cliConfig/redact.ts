const BEARER_TOKEN_PATTERN = /\bBearer\s+\S+/gi

// Triple-quoted alternatives must come before the bare-value fallback — otherwise a multiline TOML
// secret is only redacted up to the first embedded newline. The bare-value fallback intentionally
// consumes the rest of the line (not just one token): a malformed source line can put the real
// secret past a broken/empty quoted value (e.g. `api_key = "" sk-real-secret`), or inside a
// double-quoted value containing an apostrophe (e.g. `api_key = "sk-real's-secret"`) — matching only
// a single quoted pair or token would leave those trailing fragments unredacted.
const SENSITIVE_MESSAGE_PATTERN =
  /(["']?(?:api[_-]?key|token|secret|password|auth)\w*["']?\s*[:=]\s*)("""[\s\S]*?"""|'''[\s\S]*?'''|[^\r\n]*)/gi

/** Redact likely-sensitive key=value / "key": value / Bearer-token fragments embedded in a raw parser error message. */
export function redactSecretsInMessage(message: string): string {
  // Bearer must be redacted before the key=value pass, which would otherwise consume the literal
  // word "Bearer" as the "value" for a preceding "Authorization:" key and leave the real token intact.
  return message.replace(BEARER_TOKEN_PATTERN, 'Bearer <redacted>').replace(SENSITIVE_MESSAGE_PATTERN, '$1"<redacted>"')
}
