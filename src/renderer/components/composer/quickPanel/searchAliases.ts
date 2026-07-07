import type { TFunction } from 'i18next'

export function getQuickPanelSearchAliases(t: TFunction, key: string, extraAliases: readonly string[] = []): string[] {
  const aliases = new Set<string>()
  const englishText = t(key, { lng: 'en-US', defaultValue: '' })

  for (const value of [englishText, ...extraAliases]) {
    if (typeof value !== 'string') continue
    const alias = value.trim()
    if (!alias) continue
    aliases.add(alias)
  }

  return Array.from(aliases)
}
