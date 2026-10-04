import { loggerService } from '@logger'

import type { ToolApplyScope, ToolEntry } from './types'

const logger = loggerService.withContext('ToolRegistry')

/** In-memory tool catalog. Module-level singleton — see `registry`. */
export class ToolRegistry {
  private entries = new Map<string, ToolEntry>()

  // ── Registration ──

  register(entry: ToolEntry): void {
    this.entries.set(entry.name, entry)
  }

  deregister(name: string): boolean {
    return this.entries.delete(name)
  }

  // ── Catalog queries ──
  getAll(): ToolEntry[] {
    return [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  getByName(name: string): ToolEntry | undefined {
    return this.entries.get(name)
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /** Sorted by name for deterministic prompt-prefix shape. */
  selectActive(scope: ToolApplyScope): ToolEntry[] {
    const out: ToolEntry[] = []
    for (const entry of this.getAll()) {
      try {
        if (entry.applies && !entry.applies(scope)) continue
        out.push(entry.buildTool ? { ...entry, tool: entry.buildTool(scope) } : entry)
      } catch (err) {
        logger.warn(`tool ${entry.name} request materialization threw; treating as inactive`, err as Error)
      }
    }
    return out
  }
}

/** Process-wide catalog. Tests construct their own `new ToolRegistry()`. */
export const registry = new ToolRegistry()
