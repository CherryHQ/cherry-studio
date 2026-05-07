/**
 * Per-topic cache for resolved {@link ToolSet}s.
 *
 * Why this exists: `registry.selectActive(scope)` runs every request and its
 * `applies` predicates depend on user-toggleable inputs (web-search flag,
 * knowledge-base ids, MCP tool ids). Even when those inputs are unchanged
 * between turn N and turn N+1 of the same conversation, calling `selectActive`
 * again produces a fresh `ToolSet` object. Anthropic's prompt prefix cache is
 * keyed on the byte-shape of the request, and any drift in the tool block
 * (re-ordered keys, fresh closures embedded in tool definitions, etc.) misses
 * the cache for the rest of the conversation. Snapshotting the resolved
 * `ToolSet` per `topicId` and reusing the same reference across turns keeps
 * the prefix bytes stable.
 *
 * Invalidation strategy:
 *   1. **Signature-based (automatic).** Each cached entry carries a sha256
 *      signature of the inputs that drive `applies()`. When the user toggles
 *      web search / changes the KB list / enables a new MCP server between
 *      turns, the next resolve recomputes a different signature and
 *      transparently rebuilds the toolset.
 *   2. **Topic-explicit.** {@link ToolsetCache.invalidate} drops a single
 *      topic's entry — wired into AiStreamManager's grace-period cleanup so
 *      memory stays bounded.
 *   3. **Shutdown.** {@link ToolsetCache.invalidateAll} clears everything,
 *      called from AiStreamManager.onStop.
 *
 * No subscription to assistant-settings-change events is wired today: the
 * signature-based path already handles in-process toggles correctly, and the
 * data layer (`AssistantService`) does not currently emit per-row change
 * events. If a future event bus appears, plug it in via {@link invalidate}
 * keyed by topics owned by the changed assistant. (TODO-cache-invalidation)
 */

import { createHash } from 'node:crypto'

import { loggerService } from '@logger'
import type { ToolSet } from 'ai'

import type { ToolRegistry } from '../tools/registry'
import type { ToolApplyScope } from '../tools/types'

const logger = loggerService.withContext('ToolsetCache')

interface CacheEntry {
  readonly tools: ToolSet
  readonly signature: string
}

/**
 * Stable signature over the subset of {@link ToolApplyScope} that current
 * `applies` predicates consult. Order-insensitive collections (KB ids, MCP
 * tool ids) are sorted before joining so callers can pass `Set` / `Array`
 * inputs in any order without missing the cache. New `applies` inputs added
 * to the tool layer must extend this function.
 */
export function computeToolSignature(scope: ToolApplyScope): string {
  const assistantId = scope.assistant?.id ?? ''
  const enableWebSearch = String(scope.assistant?.settings?.enableWebSearch ?? false)
  const knowledgeBaseIds = (scope.assistant?.knowledgeBaseIds ?? []).slice().sort().join(',')
  const mcpToolIds = [...scope.mcpToolIds].sort().join(',')
  const payload = [assistantId, enableWebSearch, knowledgeBaseIds, mcpToolIds].join('|')
  return createHash('sha256').update(payload).digest('hex')
}

/** Active entries in a {@link ToolEntry} list materialised into a {@link ToolSet}. */
function materialiseToolSet(registry: ToolRegistry, scope: ToolApplyScope): ToolSet {
  const entries = registry.selectActive(scope)
  const tools: ToolSet = {}
  for (const entry of entries) tools[entry.name] = entry.tool
  return tools
}

export class ToolsetCache {
  private readonly cache = new Map<string, CacheEntry>()
  /** Hits / misses counters surfaced via {@link stats} for observability tests. */
  private hits = 0
  private misses = 0

  /**
   * Resolve the active {@link ToolSet} for a topic, reusing the previous
   * snapshot when the input signature is unchanged.
   *
   * `topicId === undefined` short-circuits the cache (no key to bind against)
   * — caller still gets a fresh resolve so behaviour is unchanged.
   */
  resolve(scope: ToolApplyScope, topicId: string | undefined, registry: ToolRegistry): ToolSet {
    if (!topicId) {
      this.misses += 1
      return materialiseToolSet(registry, scope)
    }
    const signature = computeToolSignature(scope)
    const cached = this.cache.get(topicId)
    if (cached && cached.signature === signature) {
      this.hits += 1
      return cached.tools
    }
    const tools = materialiseToolSet(registry, scope)
    this.cache.set(topicId, { tools, signature })
    this.misses += 1
    if (cached) {
      logger.debug('Toolset signature changed; invalidated cache', { topicId })
    }
    return tools
  }

  /** Drop a single topic's entry. No-op when the topic is not cached. */
  invalidate(topicId: string): void {
    this.cache.delete(topicId)
  }

  /** Drop every entry. Called on shutdown. */
  invalidateAll(): void {
    this.cache.clear()
  }

  /** Read-only inspection helpers — used by tests and debug surfaces. */
  size(): number {
    return this.cache.size
  }

  stats(): { readonly hits: number; readonly misses: number; readonly size: number } {
    return { hits: this.hits, misses: this.misses, size: this.cache.size }
  }
}

/**
 * Process-wide singleton. Mirrors the {@link ToolRegistry} pattern in the
 * same area: a single in-memory store accessed by both the request pipeline
 * (`buildAgentParams`) and the topic-lifecycle owner (`AiStreamManager`).
 *
 * Tests should construct their own `new ToolsetCache()` instance to avoid
 * cross-test pollution.
 */
export const toolsetCache = new ToolsetCache()
