import type { DeepseekChatImportConversation } from '@shared/ipc/schemas/ai'

import { getConversationImporter } from './importers'
// DeepSeek's C-end appends an AI disclaimer to the tail of the last assistant
// response when exporting. It is export-side metadata, not conversation
// content, and must not enter the imported context.
const AI_DISCLAIMER_PATTERN =
  /(?:\r?\n|\s)*(?:本回答由\s*AI\s*生成[，,]?\s*内容仅供参考[，,]?\s*请仔细甄别[。.]?|This\s+response\s+is\s+AI[-\s]generated[,.]?\s*for\s+reference\s+only[。.]?)\s*$/

const stripAiDisclaimer = (text: string): string => {
  let result = text
  while (AI_DISCLAIMER_PATTERN.test(result)) {
    result = result.replace(AI_DISCLAIMER_PATTERN, '')
  }
  return result
}

// Strip the C-end AI disclaimer, which DeepSeek appends as an export footer to
// the final assistant response. Scoped to that single message so a user prompt
// quoting the same sentence is never touched.
const sanitizeLastAssistantParts = (message: { role?: string; data?: { parts?: unknown[] } }): void => {
  if (message.role !== 'assistant') return
  const parts = message.data?.parts
  if (!Array.isArray(parts)) return
  const sanitized: unknown[] = []
  for (const part of parts) {
    const p = part as { type?: string; text?: unknown }
    if (p && p.type === 'text' && typeof p.text === 'string') {
      const stripped = stripAiDisclaimer(p.text)
      if (stripped.trim().length > 0) sanitized.push({ ...p, text: stripped })
      continue
    }
    sanitized.push(part)
  }
  if (message.data) message.data.parts = sanitized
}

/**
 * Parse a DeepSeek export ZIP for the chat-area import: reuses the agent
 * import pipeline (archive validation, fragment sanitizing, native thinking
 * parts) but skips binary attachment storage and returns plain JSON.
 */
export async function parseDeepseekArchiveForChat(file: string): Promise<DeepseekChatImportConversation[]> {
  const importer = getConversationImporter('deepseek')
  const archive = await importer.open(file)
  const signal = new AbortController().signal
  try {
    const conversations: DeepseekChatImportConversation[] = []
    let totalMessages = 0
    for (const sourceId of archive.sourceIds) {
      signal.throwIfAborted()
      const source = await archive.load(sourceId, {
        signal,
        files: {},
        saveFile: () => {},
        attachments: 'placeholder'
      })
      totalMessages += source.messages.length
      if (totalMessages > 100_000) throw new Error('DeepSeek archive has too many messages')
      const messages = source.messages
      const last = messages[messages.length - 1]
      if (last) sanitizeLastAssistantParts(last)
      conversations.push({
        name: source.name,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        activeSourceId: source.activeSourceId,
        messages: messages.map((message) => ({
          sourceId: message.sourceId,
          parentSourceId: message.parentSourceId,
          role: message.role,
          parts: message.data.parts ?? [],
          ...(message.model ? { model: message.model } : {})
        }))
      })
    }
    return conversations
  } finally {
    await archive.close()
  }
}
