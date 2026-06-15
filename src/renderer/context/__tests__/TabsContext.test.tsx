// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { languageState, translate } = vi.hoisted(() => {
  const translations: Record<string, Record<string, string>> = {
    'en-US': {
      'title.home': 'Home',
      'title.paintings': 'Paintings'
    },
    'zh-CN': {
      'title.home': '首页',
      'title.paintings': '绘画'
    }
  }

  return {
    languageState: { language: 'en-US' },
    translate: (key: string) => translations[languageState.language]?.[key] ?? key
  }
})

vi.mock('@renderer/i18n', () => ({
  default: {
    t: translate
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
    i18n: {
      language: languageState.language
    }
  })
}))

vi.mock('@renderer/data/hooks/useCache', () => {
  // Return stable references across renders. With a fresh [] every render the
  // `tabs` useMemo would recompute unconditionally, masking whether
  // `i18n.language` is actually wired into its dependency array — so the
  // language-flip assertion below would pass even if the dep were dropped.
  const pinnedTabs: unknown[] = []
  const setPinnedTabs = vi.fn()
  return {
    usePersistCache: () => [pinnedTabs, setPinnedTabs]
  }
})

import { TabsProvider, useTabsContext } from '../TabsContext'

function TabsProbe() {
  const { openTab, tabs } = useTabsContext()
  const homeTab = tabs.find((tab) => tab.id === 'home')
  const paintingsTab = tabs.find((tab) => tab.id === 'paintings-tab')
  const customTab = tabs.find((tab) => tab.id === 'mini-app-tab')

  return (
    <>
      <div data-testid="home-tab-title">{homeTab?.title}</div>
      <div data-testid="paintings-tab-title">{paintingsTab?.title}</div>
      <div data-testid="custom-tab-title">{customTab?.title}</div>
      <button
        type="button"
        onClick={() =>
          openTab('/app/paintings/zhipu', {
            id: 'paintings-tab',
            forceNew: true
          })
        }>
        Open paintings tab
      </button>
      <button
        type="button"
        onClick={() =>
          openTab('/app/mini-app/weather', {
            id: 'mini-app-tab',
            title: 'Weather App',
            forceNew: true
          })
        }>
        Open custom tab
      </button>
    </>
  )
}

describe('TabsContext language refresh', () => {
  beforeEach(() => {
    languageState.language = 'en-US'
  })

  afterEach(() => {
    cleanup()
  })

  it('refreshes localized route tab titles when the app language changes without replacing custom titles', () => {
    const { rerender } = render(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    expect(screen.getByTestId('home-tab-title')).toHaveTextContent('Home')

    fireEvent.click(screen.getByRole('button', { name: 'Open paintings tab' }))
    expect(screen.getByTestId('paintings-tab-title')).toHaveTextContent('Paintings')

    fireEvent.click(screen.getByRole('button', { name: 'Open custom tab' }))
    expect(screen.getByTestId('custom-tab-title')).toHaveTextContent('Weather App')

    languageState.language = 'zh-CN'
    rerender(
      <TabsProvider>
        <TabsProbe />
      </TabsProvider>
    )

    expect(screen.getByTestId('home-tab-title')).toHaveTextContent('首页')
    expect(screen.getByTestId('paintings-tab-title')).toHaveTextContent('绘画')
    expect(screen.getByTestId('custom-tab-title')).toHaveTextContent('Weather App')
  })
})
