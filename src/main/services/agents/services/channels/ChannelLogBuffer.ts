import type { ChannelLogEntry } from '@shared/config/types'

/**
 * Lightweight ring buffer for per-channel logs.
 * Mirrors ServerLogBuffer from MCP.
 */
export class ChannelLogBuffer {
  private maxEntries: number
  private logs: Map<string, ChannelLogEntry[]> = new Map()

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries
  }

  append(channelId: string, entry: ChannelLogEntry) {
    const list = this.logs.get(channelId) ?? []
    list.push(entry)
    while (list.length > this.maxEntries) {
      list.shift()
    }
    this.logs.set(channelId, list)
  }

  get(channelId: string): ChannelLogEntry[] {
    return [...(this.logs.get(channelId) ?? [])]
  }

  remove(channelId: string) {
    this.logs.delete(channelId)
  }
}
