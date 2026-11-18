/**
 * Error text for a failed tool subprocess: the message plus captured stderr,
 * scrubbed of credentials so a mirror URL with an embedded token never reaches
 * logs, install state, or a user-facing error.
 */
export function sanitizedCommandError(cause: unknown): string {
  let message = cause instanceof Error ? cause.message : String(cause)
  const stderr = (cause as { stderr?: unknown } | null)?.stderr
  if (typeof stderr === 'string' && stderr.trim() && !message.includes(stderr.trim())) {
    message = `${message}\n${stderr.trim()}`
  }
  return message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1***@')
    .replace(/([?&](?:access_?token|api_?key|auth|credential|password|secret)=)[^&\s]+/gi, '$1***')
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, '$1***')
}
