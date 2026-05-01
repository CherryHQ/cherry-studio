import type { Tool, ToolSet } from 'ai'

export interface RegisteredTool {
  name: string
  tool: Tool
  source: 'builtin' | 'mcp'
  /** Return false to hide this tool from the LLM. Checked at resolve() time. */
  checkAvailable?: () => boolean
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()

  register(entry: RegisteredTool): void {
    this.tools.set(entry.name, entry)
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  /**
   * Resolve tool IDs to an AI SDK ToolSet.
   * Filters out tools where checkAvailable() returns false.
   * Returns undefined if no tools are resolved (ToolLoopAgent treats undefined as "no tools").
   */
  resolve(toolIds?: string[]): ToolSet | undefined {
    if (!toolIds || toolIds.length === 0) return undefined

    const result: ToolSet = {}
    for (const id of toolIds) {
      const entry = this.tools.get(id)
      if (!entry) continue
      if (entry.checkAvailable && !entry.checkAvailable()) continue
      result[entry.name] = entry.tool
    }

    return Object.keys(result).length > 0 ? result : undefined
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): string[] {
    return Array.from(this.tools.keys())
  }
}
