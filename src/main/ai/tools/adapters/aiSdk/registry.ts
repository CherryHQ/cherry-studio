import { loggerService } from '@logger'

import type { ToolApplyScope, ToolEntry } from './types'

const logger = loggerService.withContext('ToolRegistry')

/** All conditions AND-ed; omitted fields impose no constraint. */
export interface ToolFilter {
  /** Case-insensitive substring match across name + description + namespace label. */
  query?: string
  namespace?: string
}

/** What the model sees and searches by; `namespace` itself may be an opaque id. */
const labelOf = (entry: ToolEntry): string => entry.namespaceLabel ?? entry.namespace

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
  getAll(filter?: ToolFilter): ToolEntry[] {
    let list = [...this.entries.values()]
    if (filter?.namespace !== undefined) {
      // The model can only quote the label it was shown; internal callers use the raw key.
      list = list.filter((e) => e.namespace === filter.namespace || labelOf(e) === filter.namespace)
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase()
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          labelOf(e).toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }

  getByName(name: string): ToolEntry | undefined {
    return this.entries.get(name)
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /** Groups by namespace label for `tool_search`; preserves insertion order. */
  getByNamespace(filter?: ToolFilter): Map<string, ToolEntry[]> {
    const grouped = new Map<string, ToolEntry[]>()
    for (const entry of this.getAll(filter)) {
      const label = labelOf(entry)
      const list = grouped.get(label) ?? []
      list.push(entry)
      grouped.set(label, list)
    }
    return grouped
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
