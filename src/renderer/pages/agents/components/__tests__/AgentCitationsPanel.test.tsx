import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandSharedPreferencesContext } from '@renderer/hooks/command'
import { ipcApi } from '@renderer/ipc'
import '@renderer/components/chat/citations/CitationsPanel'

import AgentCitationsPanel from '../AgentCitationsPanel'

const { openBrowserUrl } = vi.hoisted(() => ({ openBrowserUrl: vi.fn() }))

vi.mock('../AgentRightPane', () => ({ useAgentRightPaneActions: () => ({ openBrowserUrl }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.unmock('@cherrystudio/ui')

const url = 'https://example.com/reference?q=a%20b#section'

describe('Agent citation links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(ipcApi, 'request').mockImplementation(async (route) => {
      if (route === 'citation.fetch_preview') return { content: 'Reference preview' } as never
      return undefined as never
    })
  })

  it.each(['websearch', 'knowledge'] as const)('opens a %s source with left and middle clicks', async (type) => {
    const onClose = vi.fn()
    render(
      <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
        <Suspense fallback={null}>
          <AgentCitationsPanel
            open
            onClose={onClose}
            citations={[{ type, number: 1, url, title: 'Reference source' }]}
          />
        </Suspense>
      </CommandSharedPreferencesContext>
    )
    const link = await screen.findByRole('link', { name: 'Reference source' }, { timeout: 5000 })

    const middleClick = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    fireEvent(link, middleClick)
    expect(middleClick.defaultPrevented).toBe(true)
    expect(ipcApi.request).toHaveBeenCalledWith('navigation.open_route_in_main', {
      path: `/app/browser?${new URLSearchParams({ url })}`
    })
    expect(openBrowserUrl).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(link)
    expect(openBrowserUrl).toHaveBeenCalledExactlyOnceWith(url)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['websearch', 'knowledge'] as const)(
    'opens a %s source in the current session browser and closes the citation overlay',
    async (type) => {
      const onClose = vi.fn()
      render(
        <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
          <Suspense fallback={null}>
            <AgentCitationsPanel
              open
              onClose={onClose}
              citations={[{ type, number: 1, url, title: 'Reference source' }]}
            />
          </Suspense>
        </CommandSharedPreferencesContext>
      )
      const link = await screen.findByRole('link', { name: 'Reference source' }, { timeout: 5000 })
      fireEvent.contextMenu(link)
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.link.open_browser' }))
      await waitFor(() => expect(openBrowserUrl).toHaveBeenCalledWith(url))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(vi.mocked(ipcApi.request).mock.calls.some(([route]) => route === 'navigation.open_route_in_main')).toBe(
        false
      )
      expect(
        vi.mocked(ipcApi.request).mock.calls.some(([route]) => route === 'system.shell.open_external_website')
      ).toBe(false)
    }
  )
})
