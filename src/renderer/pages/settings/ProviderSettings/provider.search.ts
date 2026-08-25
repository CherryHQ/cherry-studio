import type { SettingsSearchEntry } from '../settingsSearch/types'

// Indexed rows = the provider detail column, which always mounts for the
// selected provider (persisted last selection, else the first visible one).
// Login-based providers (claude-code/codex/grok OAuth) render no key/host rows
// and registry meta can hide either field — declared exception: the focus
// scroll gives up silently by design and the jump still lands on the page.
export const route = '/settings/provider'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'api-key',
    titleKey: 'settings.provider.api_key.label',
    aliases: ['api key', 'key', 'secret']
  },
  {
    anchorId: 'api-host',
    titleKey: 'settings.provider.api_host',
    aliases: ['endpoint', 'base url', '端点', '接口地址']
  },
  {
    anchorId: 'model-list',
    titleKey: 'settings.models.list_title'
  }
]
