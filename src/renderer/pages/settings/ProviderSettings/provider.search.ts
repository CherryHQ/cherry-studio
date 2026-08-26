import type { SettingsSearchEntry } from '../settingsSearch/types'

// Indexed rows = the provider detail column, which always mounts for the
// selected provider (persisted last selection, else the first visible one).
// The login-flow entries carry providerId so the jump selects the provider
// via ?id= and flashes its auth section (setting-provider-auth-<id>, rendered
// by AuthConnectionSlotsLayout). Registry meta can still hide the key/host
// fields per provider — declared exception: the focus scroll gives up
// silently by design and the jump still lands on the page.
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
  },
  {
    anchorId: 'auth-claude-code',
    titleKey: 'provider.claude-code',
    providerId: 'claude-code',
    aliases: ['claude code', 'cli', 'oauth', '登录']
  },
  {
    anchorId: 'auth-openai-codex',
    titleKey: 'provider.openai-codex',
    descriptionKey: 'settings.provider.codex.description',
    providerId: 'openai-codex',
    aliases: ['codex', 'chatgpt', 'oauth', '登录']
  },
  {
    anchorId: 'auth-github-copilot',
    titleKey: 'provider.copilot',
    providerId: 'copilot',
    aliases: ['copilot', 'github copilot', 'oauth', '登录']
  },
  {
    anchorId: 'auth-grok-cli',
    titleKey: 'provider.grok-cli',
    providerId: 'grok-cli',
    aliases: ['grok', 'cli', 'oauth', '登录']
  }
]
