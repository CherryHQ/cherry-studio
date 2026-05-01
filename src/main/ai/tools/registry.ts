import type { ToolEntry } from './types'

/**
 * Filter accepted by {@link ToolRegistry.getAll}. All conditions are AND-ed;
 * omitted fields impose no constraint.
 */
export interface ToolFilter {
  /** Substring match (case-insensitive) against name + description + namespace. */
  query?: string
  /** Exact namespace match. */
  namespace?: string
}

/**
 * In-memory tool catalog with declarative registration.
 *
 * Module-level singleton — see {@link registry}. Tests get fresh instances
 * via `new ToolRegistry()` to avoid cross-test pollution.
 */
export class ToolRegistry {
  private entries = new Map<string, ToolEntry>()

  // ── Registration ──

  register(entry: ToolEntry): void {
    this.entries.set(entry.name, entry)
  }

  /** Remove by name. No-op when the entry doesn't exist. */
  deregister(name: string): boolean {
    return this.entries.delete(name)
  }

  // ── Catalog queries ──

  /**
   * List entries matching {@link ToolFilter}. Availability checks are NOT
   * applied here — they're async and not every caller can await. Callers
   * that need availability filtering should iterate the result and call
   * {@link isAvailable}.
   */
  getAll(filter?: ToolFilter): ToolEntry[] {
    let list = [...this.entries.values()]
    if (filter?.namespace !== undefined) {
      list = list.filter((e) => e.namespace === filter.namespace)
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase()
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.namespace.toLowerCase().includes(q)
      )
    }
    return list
  }

  getByName(name: string): ToolEntry | undefined {
    return this.entries.get(name)
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /**
   * Group matching entries by namespace. Used by the `tool_search` meta-tool
   * so the model browses by domain (web, kb, mcp:gmail, ...) rather than a
   * flat list. Insertion order is preserved per group.
   */
  getByNamespace(filter?: ToolFilter): Map<string, ToolEntry[]> {
    const grouped = new Map<string, ToolEntry[]>()
    for (const entry of this.getAll(filter)) {
      const list = grouped.get(entry.namespace) ?? []
      list.push(entry)
      grouped.set(entry.namespace, list)
    }
    return grouped
  }

  /**
   * Resolve {@link ToolEntry.isAvailable} for a single entry. Treats
   * thrown checks and absent checks as available (the entry stays visible);
   * only an explicit `false` return hides it.
   */
  async isAvailable(entry: ToolEntry): Promise<boolean> {
    if (!entry.isAvailable) return true
    try {
      return (await entry.isAvailable()) !== false
    } catch {
      return true
    }
  }
}

/**
 * Process-wide tool catalog. Mirrors the Hermes pattern of a module-level
 * singleton so tool files can `register(...)` at import time without
 * threading a registry instance through call sites.
 *
 * Tests should construct their own `new ToolRegistry()` rather than mutating
 * this singleton.
 */
export const registry = new ToolRegistry()
