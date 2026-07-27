/**
 * Resolve the effective knowledge scope used by assistant and Agent runtimes.
 * Static bindings take precedence; a per-turn composer selection is only used
 * when no static binding exists.
 */
export function resolveKnowledgeBaseScope(
  configuredIds: readonly string[] | null | undefined,
  selectedIds: readonly string[] | null | undefined
): string[] {
  return Array.from(new Set((configuredIds?.length ? configuredIds : selectedIds) ?? []))
}
