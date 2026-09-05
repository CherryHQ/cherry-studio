import { settingsMenu } from '../settingsMenu'
import type { SettingsSearchSection, SettingsSearchSectionModule } from './types'

const globModules = import.meta.glob('../**/*.search.ts', { eager: true })

// Merge leaves per route; module keys sorted so multi-file sections keep a
// deterministic declaration order regardless of glob iteration order.
const leavesByRoute = new Map<string, SettingsSearchSectionModule['entries']>()
for (const [, mod] of Object.entries(globModules).sort(([a], [b]) => a.localeCompare(b))) {
  const m = mod as Partial<SettingsSearchSectionModule>
  if (typeof m.route !== 'string' || !Array.isArray(m.entries)) continue
  const existing = leavesByRoute.get(m.route)
  if (existing) existing.push(...m.entries)
  else leavesByRoute.set(m.route, [...m.entries])
}

/**
 * Search index: the menu array provides the always-searchable section baseline
 * (D7 — adding a section registers it here structurally); `*.search.ts` leaves
 * merge in by route. Output order (menu order → declaration order) is the
 * engine's tie-break source of truth. Modules targeting routes outside the
 * menu are ignored — extend the menu array first.
 */
export const settingsSearchSections: SettingsSearchSection[] = settingsMenu.map((item) => ({
  route: item.route,
  sectionTitleKey: item.titleKey,
  entries: leavesByRoute.get(item.route) ?? []
}))
