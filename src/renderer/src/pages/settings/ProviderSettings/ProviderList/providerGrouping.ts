import type { Provider } from '@shared/data/types/provider'

/**
 * Sidebar entry produced by {@link groupProvidersByPreset}.
 *
 * `single` keeps the provider visually flat (no chevron, no folding); `group`
 * folds together ≥2 providers that share the same `presetProviderId` (e.g.
 * a user running multiple Azure OpenAI deployments).
 */
export type ProviderListEntry =
  | { kind: 'single'; provider: Provider }
  | { kind: 'group'; presetProviderId: string; members: Provider[] }

/**
 * Folds same-preset providers into collapsible groups while preserving the
 * caller's order.
 *
 * Rule: a preset becomes a group only when ≥2 providers in `providers` share
 * its `presetProviderId`. Single-instance presets and custom providers (no
 * `presetProviderId`) stay flat — keeps the common-case sidebar one-click.
 *
 * The group's position is anchored at the **first** member's index, so the
 * sidebar layout doesn't jump around when membership changes around the
 * 1↔2 threshold.
 */
export function groupProvidersByPreset(providers: Provider[]): ProviderListEntry[] {
  const counts = new Map<string, number>()
  for (const provider of providers) {
    const preset = provider.presetProviderId
    if (!preset) continue
    counts.set(preset, (counts.get(preset) ?? 0) + 1)
  }

  const entries: ProviderListEntry[] = []
  const groupIndexByPreset = new Map<string, number>()

  for (const provider of providers) {
    const preset = provider.presetProviderId
    if (preset && (counts.get(preset) ?? 0) >= 2) {
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
