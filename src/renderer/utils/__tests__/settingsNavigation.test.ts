import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string) =>
      ({
        'title.settings': '设置',
        'apiGateway.title': 'API 网关',
        'settings.model': '默认模型',
        'settings.provider.title': '模型服务',
        'agent.settings.toolsMcp.mcp.tab': 'MCP'
      })[key] ?? key
  }
}))

import { getSettingsRecentTitle } from '../settingsNavigation'

describe('getSettingsRecentTitle', () => {
  it('keeps the coarse Settings label on the root route and unmatched subpages', () => {
    expect(getSettingsRecentTitle('/settings')).toBe('设置')
    expect(getSettingsRecentTitle('/settings/')).toBe('设置')
    expect(getSettingsRecentTitle('/settings/system')).toBe('设置')
  })

  it('joins Settings with the matching navigation label for known subpages', () => {
    expect(getSettingsRecentTitle('/settings/api-gateway')).toBe('设置 / API 网关')
    expect(getSettingsRecentTitle('/settings/model')).toBe('设置 / 默认模型')
    expect(getSettingsRecentTitle('/settings/provider?id=openai')).toBe('设置 / 模型服务')
    expect(getSettingsRecentTitle('/settings/mcp/servers')).toBe('设置 / MCP')
  })

  it('uses the caller-provided translator for display titles', () => {
    const translate = vi.fn(
      (key: string) =>
        ({
          'title.settings': 'Settings',
          'settings.model': 'Default Model'
        })[key] ?? key
    )

    expect(getSettingsRecentTitle('/settings/model', translate as unknown as TFunction)).toBe(
      'Settings / Default Model'
    )
    expect(translate).toHaveBeenCalledWith('title.settings')
    expect(translate).toHaveBeenCalledWith('settings.model')
  })

  it('does not apply settings recent titles to non-settings routes', () => {
    expect(getSettingsRecentTitle('/app/chat')).toBeUndefined()
    expect(getSettingsRecentTitle('/app/settings')).toBeUndefined()
  })
})
