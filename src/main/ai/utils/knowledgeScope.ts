import { loggerService } from '@logger'

const logger = loggerService.withContext('knowledgeScope')

/**
 * Resolve the effective knowledge scope used by assistant and Agent runtimes.
 *
 * A static binding is a ceiling, never a floor: main cannot trust a renderer/IPC-supplied id list to
 * stay within the configured bases (the composer UI happens to restrict picks to that set today, but
 * that's a UI nicety, not a security boundary). So a per-turn selection can only ever NARROW a
 * binding — ids outside it are dropped, and the scope can never be widened into an unbound base.
 * Within the ceiling the selection wins, so the composer picker means what it shows. An empty (or
 * entirely out-of-scope) selection means "no per-turn narrowing", not "no knowledge" — it falls back
 * to the full binding rather than silently cutting the agent off from its own bases.
 *
 * With no static binding the selection alone defines the scope — the actual gap this resolves:
 * composer-only, ad-hoc knowledge base use.
 *
 * The result is canonical (deduplicated, sorted) so callers can compare two scopes by value and
 * hash one into a rebuild signature without re-normalizing.
 */
export function resolveKnowledgeBaseScope(
  configuredIds: readonly string[] | null | undefined,
  selectedIds: readonly string[] | null | undefined
): string[] {
  if (!configuredIds?.length) return canonicalize(selectedIds)
  if (!selectedIds?.length) return canonicalize(configuredIds)

  const configured = new Set(configuredIds)
  const narrowed = selectedIds.filter((id) => configured.has(id))
  if (narrowed.length !== selectedIds.length) {
    logger.warn('Dropped selected knowledge bases outside the static binding', {
      outOfScopeIds: selectedIds.filter((id) => !configured.has(id))
    })
  }
  return canonicalize(narrowed.length ? narrowed : configuredIds)
}

function canonicalize(ids: readonly string[] | null | undefined): string[] {
  return Array.from(new Set(ids ?? [])).sort()
}
