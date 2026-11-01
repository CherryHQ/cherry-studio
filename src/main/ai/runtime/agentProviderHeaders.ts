/**
 * Cherry's `extraHeaders` are user-editable and can still hold non-string values (v1 settings
 * passthrough, API writes): coerce them to the `Record<string, string>` every agent runtime
 * requires — Pi throws inside its config resolver.
 */
export function toAgentProviderHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const coerced: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers) as [string, unknown][]) {
    if (value == null || typeof value === 'object') continue
    coerced[name] = String(value)
  }
  return coerced
}
