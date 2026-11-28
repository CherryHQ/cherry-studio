import type { CherryUIMessage } from '@shared/data/types/message'

export function mergeMessagesById(...sources: CherryUIMessage[][]): CherryUIMessage[] {
  const byId = new Map<string, CherryUIMessage>()

  for (const messages of sources) {
    for (const message of messages) {
      const existing = byId.get(message.id)
      if (!existing) {
        byId.set(message.id, message)
        continue
      }

      byId.set(message.id, mergeMessage(existing, message))
    }
  }

  return [...byId.values()]
}

function mergeMessage(saved: CherryUIMessage, live: CherryUIMessage): CherryUIMessage {
  return {
    ...saved,
    ...live,
    ...(saved.metadata || live.metadata ? { metadata: { ...saved.metadata, ...live.metadata } } : {})
  }
}

/** Each projected reply has a unique ID. Only rows on the selected path have a display index. */
export function mergeLiveReplies(
  history: CherryUIMessage[],
  replies: readonly CherryUIMessage[],
  displayIndex: (id: string) => number | undefined,
  missing: 'append' | 'omit'
): CherryUIMessage[] {
  let result = history
  for (const reply of replies) {
    const index = displayIndex(reply.id)
    if (index === undefined ? missing === 'omit' : history[index] === reply) continue
    if (result === history) result = history.slice()
    if (index === undefined) result.push(reply)
    else result[index] = mergeMessage(history[index], reply)
  }
  return result
}
