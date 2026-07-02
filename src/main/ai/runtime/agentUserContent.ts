import { fileURLToPath } from 'node:url'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessions'

/**
 * Build the user-turn content sent to an agent runtime. Agent runtimes are
 * filesystem agents (they have no native multimodal channel here), so attached
 * files are forwarded as their absolute paths appended to the text — the agent
 * reads them with its own tools. Driver-neutral: shared by the Claude Code and
 * pi drivers so they cannot drift on attachment handling.
 */
export function buildAgentUserContent(message: AgentSessionMessageEntity): string {
  const text = extractMessageText(message)
  const paths = extractAttachmentPaths(message)
  if (paths.length === 0) return text

  const list = paths.map((path) => `- ${path}`).join('\n')
  const section = `Attached files (read them with your tools using these absolute paths):\n${list}`
  return text.trim() ? `${text}\n\n${section}` : section
}

function extractMessageText(message: AgentSessionMessageEntity): string {
  return (
    message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

/** Absolute local paths of `file://`-backed attachment parts (composer attachments). */
function extractAttachmentPaths(message: AgentSessionMessageEntity): string[] {
  const paths: string[] = []
  for (const part of message.data?.parts ?? []) {
    // `parts` is a typed `CherryMessagePart[]`, so `type === 'file'` narrows to `FileUIPart`.
    if (part.type !== 'file' || !part.url.startsWith('file://')) continue
    paths.push(fileURLToPath(part.url))
  }
  return paths
}
