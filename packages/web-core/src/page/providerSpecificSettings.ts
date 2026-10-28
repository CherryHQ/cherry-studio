// Wraps the desktop provider panels: sign-in popups cannot report back to a cross-origin isolated
// page, and CLI logins, GitHub Copilot and the OVMS installer need the desktop. API keys still work.
import {
  PROVIDER_SPECIFIC_SETTINGS_REGISTRY as DESKTOP_REGISTRY,
  type ProviderSpecificPlacement,
  type ProviderSpecificRegistryEntry
} from '@renderer/pages/settings/ProviderSettings/ProviderSpecific/providerSpecificSettingsRegistry'

export type {
  ProviderSpecificContext,
  ProviderSpecificPlacement,
  ProviderSpecificRegistryEntry
} from '@renderer/pages/settings/ProviderSettings/ProviderSpecific/providerSpecificSettingsRegistry'

const desktopOnly = new Set([
  'oauth',
  'cherryin-oauth',
  'ovms-settings',
  'claude-code-settings',
  'codex-oauth',
  'grok-cli-oauth',
  'copilot-settings'
])

export const PROVIDER_SPECIFIC_SETTINGS_REGISTRY = Object.fromEntries(
  Object.entries(DESKTOP_REGISTRY).map(([placement, entries]) => [
    placement,
    entries.filter(({ key }) => !desktopOnly.has(key))
  ])
) as Record<ProviderSpecificPlacement, ProviderSpecificRegistryEntry[]>
