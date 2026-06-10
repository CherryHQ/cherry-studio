// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type * as RouteTitle from '@renderer/utils/routeTitle'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: () => [[], vi.fn()]
}))

vi.mock('@renderer/utils/routeTitle', async () => {
  const actual = await vi.importActual<typeof RouteTitle>('@renderer/utils/routeTitle')
  return {
    ...actual,
    getDefaultRouteTitle: (url: string) =>
      ({
        '/app/agents': 'Agent',
        '/app/chat': 'Chat'
      })[url] ?? url
  }
})

import { TabsProvider, useTabsContext } from '../TabsContext'

function TabTitleWriter() {
  const { tabs, updateTab } = useTabsContext()
  const didUpdateRef = useRef(false)

  useEffect(() => {
    if (didUpdateRef.current) return
    didUpdateRef.current = true
    updateTab('home', { title: 'Session title', icon: 'icon:spark' })
  }, [updateTab])

  return <div data-testid="home-title">{tabs.find((tab) => tab.id === 'home')?.title}</div>
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TabsContext', () => {
  it('preserves page-owned titles for the fixed home conversation tab', async () => {
    render(
      <TabsProvider
        initialDefaultTab={{
          id: 'home',
          type: 'route',
          url: '/app/agents',
          title: '',
          lastAccessTime: Date.now(),
          isDormant: false
        }}
        includePinnedTabs={false}>
        <TabTitleWriter />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('home-title')).toHaveTextContent('Session title'))
  })
})
