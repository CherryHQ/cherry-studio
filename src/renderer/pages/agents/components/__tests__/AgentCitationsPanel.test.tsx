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

describe('Agent citation link context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(ipcApi, 'request').mockImplementation(async (route) => {
      if (route === 'citation.fetch_preview') return { content: 'Reference preview' } as never
      return undefined as never
    })
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
