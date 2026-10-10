import type { Provider } from '@shared/data/types/provider'

/**
 * Sidebar entry produced by {@link groupProvidersByPreset}.
 *
 * `single` keeps the provider visually flat (no chevron, no folding); `group`
 * folds together ≥2 providers that share the same `presetProviderId` (e.g.
 * a user running multiple Azure OpenAI deployments). `members` is a non-empty
 * tuple so `members[0]` is statically known to exist.
 */
export type ProviderListEntry =
  | { kind: 'single'; provider: Provider }
  | { kind: 'group'; presetProviderId: string; members: [Provider, ...Provider[]] }

/**
 * The set of `presetProviderId`s that fold into a group: a preset qualifies
 * only when ≥2 providers in `providers` share it. Single source of truth for
 * the grouping threshold so callers don't reimplement the count.
 */
export function getGroupedPresetIds(providers: Provider[]): Set<string> {
  const counts = new Map<string, number>()
  for (const provider of providers) {
    const preset = provider.presetProviderId
    if (!preset) continue
    counts.set(preset, (counts.get(preset) ?? 0) + 1)
  }
  const grouped = new Set<string>()
  for (const [preset, count] of counts) {
    if (count >= 2) grouped.add(preset)
  }
  return grouped
}

/**
 * Folds same-preset providers into collapsible groups while preserving the
 * caller's order.
 *
 * The group's position is anchored at the **first** member's index, so the
 * sidebar layout doesn't jump around when membership changes around the
 * 1↔2 threshold.
 */
export function groupProvidersByPreset(providers: Provider[]): ProviderListEntry[] {
  const groupedPresets = getGroupedPresetIds(providers)

  const entries: ProviderListEntry[] = []
  const groupIndexByPreset = new Map<string, number>()

  for (const provider of providers) {
    const preset = provider.presetProviderId
    if (preset && groupedPresets.has(preset)) {
      const existingIndex = groupIndexByPreset.get(preset)
      if (existingIndex === undefined) {
        groupIndexByPreset.set(preset, entries.length)
        entries.push({ kind: 'group', presetProviderId: preset, members: [provider] })
      } else {
        const existing = entries[existingIndex]
        if (existing.kind === 'group') {
          existing.members.push(provider)
        }
      }
    } else {
      entries.push({ kind: 'single', provider })
    }
  }

  return entries
}
