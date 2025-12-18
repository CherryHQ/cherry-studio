export type MCPServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'stderr' | 'stdout'
  message: string
  data?: any
  source?: string
}

/**
 * Lightweight ring buffer for per-server MCP logs.
 */
export class ServerLogBuffer {
  private maxEntries: number
  private logs: Map<string, MCPServerLogEntry[]> = new Map()

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries
  }

  append(serverKey: string, entry: MCPServerLogEntry) {
    const list = this.logs.get(serverKey) ?? []
    list.push(entry)
    if (list.length > this.maxEntries) {
      list.splice(0, list.length - this.maxEntries)
    }
    this.logs.set(serverKey, list)
  }

  get(serverKey: string): MCPServerLogEntry[] {
    return [...(this.logs.get(serverKey) ?? [])]
  }

  remove(serverKey: string) {
    this.logs.delete(serverKey)
  }
}
