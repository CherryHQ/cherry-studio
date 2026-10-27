// Wraps the desktop provider list filter: providers that sign in through a CLI or an app-managed
// login (Claude Code, Codex, Grok CLI) or GitHub Copilot's device login need the desktop.
import { isProviderSettingsListVisibleProvider as isDesktopListVisible } from '@renderer/utils/providerSettings'
import type { Provider } from '@shared/data/types/provider'
import { isLoginBasedProvider, matchesPreset } from '@shared/utils/provider'

export function isProviderSettingsListVisibleProvider(provider: Provider): boolean {
  return isDesktopListVisible(provider) && !isLoginBasedProvider(provider) && !matchesPreset(provider, 'copilot')
}
