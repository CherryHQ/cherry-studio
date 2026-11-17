import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackupEmptyScene } from '@renderer/components/BackupEmptyScene'
import { DiagnosticEmptyScene } from '@renderer/components/feedback/DiagnosticEmptyScene'
import { OnboardingNoModelsScene } from '@renderer/windows/main/onboarding/OnboardingNoModelsScene'

import {
  ApiKeyEmptyScene,
  ArchiveEmptyScene,
  BrowserHistoryEmptyScene,
  ChannelsEmptyScene,
  DevicesEmptyScene,
  McpEmptyScene,
  ProviderModelsEmptyScene,
  SettingsSearchEmptyScene,
  SkillMissingScene,
  UsageEmptyScene
} from '../SettingsEmptyScenes'

vi.unmock('@cherrystudio/ui')

describe('settings empty scenes', () => {
  afterEach(async () => {
    await getI18n().changeLanguage('en-us')
  })

  it.each([
    ['SettingsSearchEmptyScene', SettingsSearchEmptyScene],
    ['BrowserHistoryEmptyScene', BrowserHistoryEmptyScene],
    ['McpEmptyScene', McpEmptyScene],
    ['ProviderModelsEmptyScene', ProviderModelsEmptyScene],
    ['ApiKeyEmptyScene', ApiKeyEmptyScene],
    ['UsageEmptyScene', UsageEmptyScene],
    ['ArchiveEmptyScene', ArchiveEmptyScene],
    ['SkillMissingScene', SkillMissingScene],
    ['ChannelsEmptyScene', ChannelsEmptyScene],
    ['DevicesEmptyScene', DevicesEmptyScene],
    ['BackupEmptyScene', BackupEmptyScene],
    ['DiagnosticEmptyScene', DiagnosticEmptyScene],
    ['OnboardingNoModelsScene', OnboardingNoModelsScene]
  ])('%s draws only translated words in Chinese', async (_, Scene) => {
    await getI18n().changeLanguage('zh-cn')
    const { container } = render(<Scene />)

    // "MCP" and "API" are terms the Chinese locale keeps in English ("MCP 服务器", "API 密钥").
    const text = container.textContent?.replace(/MCP|API/g, '') ?? ''
    expect(text.match(/[A-Za-z]{2,}/g) ?? []).toEqual([])
  })
})
