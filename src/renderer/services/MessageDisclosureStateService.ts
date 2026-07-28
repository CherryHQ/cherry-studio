import { LRUCache } from 'lru-cache'

export const MESSAGE_DISCLOSURE_STATE_MAX_ENTRIES = 500

interface MessageDisclosureStateEntry {
  expanded: boolean
  messageId: string
}

function createEntryKey(messageId: string, disclosureId: string): string {
  return JSON.stringify([messageId, disclosureId])
}

/**
 * Window-local visual state for message disclosures.
 *
 * Entries survive streamed subtree replacement and tab unmount/remount. The
 * LRU bound makes retention deterministic without expiring active entries on
 * a timer; destroying the renderer window releases the whole service.
 */
export class MessageDisclosureStateService {
  private readonly entries: LRUCache<string, MessageDisclosureStateEntry>

  constructor(maxEntries = MESSAGE_DISCLOSURE_STATE_MAX_ENTRIES) {
    this.entries = new LRUCache({ max: maxEntries })
  }

  get(messageId: string, disclosureId: string): boolean | undefined {
    return this.entries.get(createEntryKey(messageId, disclosureId))?.expanded
  }

  set(messageId: string, disclosureId: string, expanded: boolean): void {
    this.entries.set(createEntryKey(messageId, disclosureId), { expanded, messageId })
  }

  invalidateMessages(messageIds: Iterable<string>): void {
    const ids = new Set(messageIds)
    if (ids.size === 0) return

    for (const [key, entry] of this.entries.entries()) {
      if (ids.has(entry.messageId)) {
        this.entries.delete(key)
      }
    }
  }
}

export const messageDisclosureStateService = new MessageDisclosureStateService()
