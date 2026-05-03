import type { Message } from '@shared/data/types/message'

/**
 * Wrap content in `<name attr="v" …>…</name>`. Idempotent: if `content`
 * already starts with the same open-tag, returns input unchanged. Defends
 * future re-wrap scenarios (e.g., compaction merging adjacent reminders).
 */
export function wrapInXmlTag(name: string, attrs: Record<string, string> | undefined, content: string): string {
  const open =
    attrs && Object.keys(attrs).length > 0
      ? `<${name} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ')}>`
      : `<${name}>`
  if (content.startsWith(`<${name} `) || content.startsWith(`<${name}>`)) return content
  return `${open}\n${content}\n</${name}>`
}

/** Build a `Message` ready for `Agent.injectReminder` or direct DB write. */
export function buildSyntheticUserMessage(topicId: string, text: string): Message {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    topicId,
    parentId: null,
    role: 'user',
    data: { parts: [{ type: 'text', text }] },
    searchableText: '',
    status: 'success',
    siblingsGroupId: 0,
    createdAt: now,
    updatedAt: now
  }
}

export function buildAsyncTaskResultMessage(topicId: string, taskId: string, text: string): Message {
  return buildSyntheticUserMessage(topicId, wrapInXmlTag('async-task-result', { task: taskId }, text))
}

export function buildAsyncTaskErrorMessage(topicId: string, taskId: string, errorText: string): Message {
  return buildSyntheticUserMessage(topicId, wrapInXmlTag('async-task-error', { task: taskId }, errorText))
}
