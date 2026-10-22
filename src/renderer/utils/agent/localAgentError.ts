export function classifyLocalAgentError(error: unknown): {
  kind: 'region' | 'authentication' | 'timeout' | 'unknown'
  message: string
} {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^(?:(?:IpcError|Error):\s*)+/, '')
  if (/not (?:currently )?available in your (?:location|region)|unsupported (?:location|region)/i.test(message)) {
    return { kind: 'region', message }
  }
  if (/authentication required|not authenticated|login required/i.test(message)) {
    return { kind: 'authentication', message }
  }
  if (/timed out/i.test(message)) return { kind: 'timeout', message }
  return { kind: 'unknown', message }
}
