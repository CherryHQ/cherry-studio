/**
 * `/compact [optional focus]` is the one slash command Cherry-managed
 * runtimes implement themselves (declared per runtime in
 * `agentRuntimeCapabilities`). The exact-first-token parse is shared so the
 * pi and ai-sdk drivers, plus the ai-sdk replay filter, agree on what counts
 * as a compact command.
 */
export function parseManualCompactCommand(content: string): { instructions: string } | undefined {
  const trimmed = content.trim()
  if (!/^\/compact(?:\s|$)/.test(trimmed)) return undefined
  return { instructions: trimmed.slice('/compact'.length).trim() }
}
