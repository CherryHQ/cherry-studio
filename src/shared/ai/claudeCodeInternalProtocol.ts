/**
 * Claude Code currently exposes a few lifecycle details only through human-readable receipts.
 * Keep those internal-format adapters in one place so upstream wording changes have one boundary.
 */

const AGENT_LAUNCH_RECEIPT_PREFIXES = [
  'Async agent launched successfully. (This tool result is internal metadata',
  'Remote agent launched successfully. (This tool result is internal metadata'
] as const

export interface ClaudeCodeBackgroundBashReceipt {
  taskId: string
  outputFile: string
}

export function parseClaudeCodeBackgroundBashReceipt(text: string): ClaudeCodeBackgroundBashReceipt | undefined {
  const lines = text.split(/\r?\n/)
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex].trim()
    const match = /^Command running in background with ID:\s*([^.\r\n]+)\.\s*Output is being written to:\s*/i.exec(line)
    if (!match) continue

    const taskId = match[1].trim()
    const pathStart = match[0].length
    const expectedBasename = `${taskId}.output`
    const pathEnd = line.lastIndexOf(expectedBasename)
    if (!taskId || pathEnd < pathStart) continue

    return {
      taskId,
      outputFile: line.slice(pathStart, pathEnd + expectedBasename.length).trim()
    }
  }
  return undefined
}

export function isClaudeCodeAgentLaunchReceipt(text: string): boolean {
  return AGENT_LAUNCH_RECEIPT_PREFIXES.some((prefix) => text.startsWith(prefix))
}

export function splitClaudeCodeAgentCompletionReceipt(text: string): { text: string; receipt?: string } {
  const match = text.match(
    /(?:^|\r?\n)[ \t]*(?:<usage>\s*)?(agentId:\s+\S+[\s\S]*?)(?:\s*<usage>\s*)?(subagent_tokens:\s+\d+\s+tool_uses:\s+\d+\s+duration_ms:\s+\d+)\s*(?:<\/usage>)?\s*$/
  )
  if (!match || match.index === undefined) return { text }

  return {
    text: text.slice(0, match.index).trimEnd(),
    receipt: `${match[1].trimEnd()}\n${match[2].trim()}`
  }
}
