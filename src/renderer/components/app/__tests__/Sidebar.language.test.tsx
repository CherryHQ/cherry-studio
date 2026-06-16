// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { languageState, getT } = vi.hoisted(() => {
  const labels: Record<string, Record<string, string>> = {
    'en-US': {
      assistants: 'Assistants'
    },
    'zh-CN': {
      assistants: '助手'
    }
  }

  // One stable `t` per language, mirroring react-i18next: its identity changes
  // only when the language changes. This lets the test fail if `t` is dropped
  // from the Sidebar label useMemo deps (a fresh `t` every render would mask it).
  const tByLanguage: Record<string, (key: string) => string> = {}
  for (const language of Object.keys(labels)) {
    tByLanguage[language] = (key: string) => labels[language]?.[key] ?? key
  }

  return {
    languageState: { language: 'en-US' },
    getT: () => tByLanguage[languageState.language]
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: languageState.language
    },
    t: getT()
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getSidebarFavoriteLabelKey: (key: string) => key
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (url: string) => url
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useModel', () => ({
  modelGenerating: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    defaultPaintingProvider: 'zhipu'
  })
}))

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({
    activeTab: {
      id: 'home',
      type: 'route',
      url: '/home'
    },
    openTab: vi.fn(),
    updateTab: vi.fn()
  })
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'app-logo.png',
  UserAvatar: 'user-avatar.png',
  isLocalAi: false
}))

vi.mock('../../Popups/UserPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

import Sidebar from '../Sidebar'

describe('Sidebar language refresh', () => {
  beforeEach(() => {
    languageState.language = 'en-US'
    MockUsePreferenceUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('ui.sidebar.favorites', ['assistants'])
    MockUseCacheUtils.setPersistCacheValue('ui.sidebar.width', 170)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('refreshes menu item labels when the app language changes', () => {
    const { rerender } = render(<Sidebar />)

    expect(screen.getByRole('button', { name: 'Assistants' })).toBeInTheDocument()

    languageState.language = 'zh-CN'
    rerender(<Sidebar />)

    expect(screen.getByRole('button', { name: '助手' })).toBeInTheDocument()
  })
})
