import type { CherryUIMessage } from '@shared/data/types/message'

export function mergeMessagesById(...sources: CherryUIMessage[][]): CherryUIMessage[] {
  const order: string[] = []
  const byId = new Map<string, CherryUIMessage>()

  for (const messages of sources) {
    for (const message of messages) {
      const existing = byId.get(message.id)
      if (!existing) {
        order.push(message.id)
        byId.set(message.id, message)
        continue
      }

      const metadata = existing.metadata || message.metadata ? { ...existing.metadata, ...message.metadata } : undefined
      byId.set(message.id, {
        ...existing,
        ...message,
        ...(metadata && { metadata })
      })
    }
  }

  return order.flatMap((id) => {
    const message = byId.get(id)
    return message ? [message] : []
  })
}
