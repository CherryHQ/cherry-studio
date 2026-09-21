import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposerToken } from '@renderer/components/composer/tokenView'
import { CommandSharedPreferencesContext } from '@renderer/hooks/command'
import { ipcApi } from '@renderer/ipc'
import type { NativePopupMenuModel } from '@shared/types/command'

import SelectionContextMenu from '../SelectionContextMenu'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.unmock('@cherrystudio/ui')

const href = 'https://example.com/page?q=a%20b&lang=zh#section'

function renderContent(mode: 'cherry' | 'native' = 'cherry', url = href, openBrowserUrl?: (url: string) => void) {
  return render(
    <CommandSharedPreferencesContext value={{ menuPresentationMode: mode, shortcutPreferences: {} }}>
      <SelectionContextMenu openBrowserUrl={openBrowserUrl}>
        <div>
          <a href={url}>
            <span>Example website</span>
          </a>
          <p>Plain text</p>
        </div>
      </SelectionContextMenu>
    </CommandSharedPreferencesContext>
  )
}

describe('conversation link context menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.getSelection()?.removeAllRanges()
    vi.spyOn(ipcApi, 'request').mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
  })

  it('opens the host browser pane instead of a top-level browser tab when available', async () => {
    const openBrowserUrl = vi.fn()
    renderContent('cherry', href, openBrowserUrl)
    fireEvent.contextMenu(screen.getByText('Example website'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.link.open_browser' }))
    await waitFor(() => expect(openBrowserUrl).toHaveBeenCalledWith(href))
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('opens the menu on a sent user-message link token and copies its complete address', async () => {
    render(
      <CommandSharedPreferencesContext value={{ menuPresentationMode: 'cherry', shortcutPreferences: {} }}>
        <SelectionContextMenu>
          <div>
            <ComposerToken
              readOnly
              token={{ id: 'link:regression', kind: 'link', label: 'Example', promptText: href }}
            />
          </div>
        </SelectionContextMenu>
      </CommandSharedPreferencesContext>
    )
    fireEvent.contextMenu(screen.getByRole('link', { name: href }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.link.copy' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(href))
  })

  it('opens on a child of the link and copies the full URL rather than its label', async () => {
    renderContent()
    fireEvent.contextMenu(screen.getByText('Example website'))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'common.link.open_browser',
      'webview.navigation.open_external',
      'common.link.copy'
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.link.copy' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(href))
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it.each([
    [
      'common.link.open_browser',
      'navigation.open_route_in_main',
      { path: `/app/browser?${new URLSearchParams({ url: href })}` }
    ],
    ['webview.navigation.open_external', 'system.shell.open_external_website', href]
  ])('honors the explicit destination: %s', async (label, route, input) => {
    renderContent()
    fireEvent.contextMenu(screen.getByText('Example website'))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith(route, input))
    expect(ipcApi.request).toHaveBeenCalledTimes(1)
  })

  it('keeps the native menu actions and separator in the same order', async () => {
    const popup = vi
      .fn<(model: NativePopupMenuModel) => Promise<{ type: 'custom'; id: string }>>()
      .mockResolvedValue({ type: 'custom', id: 'link.copy' })
    window.api.command = { ...window.api.command, showNativePopupMenu: popup }
    renderContent('native')
    fireEvent.contextMenu(screen.getByText('Example website'))
    await waitFor(() => expect(popup).toHaveBeenCalledTimes(1))
    const model = popup.mock.calls[0][0]
    expect(model.items.map((item) => (item.type === 'custom' ? item.id : item.type))).toEqual([
      'link.openBrowser',
      'link.openExternal',
      'separator',
      'link.copy'
    ])
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(href))
  })

  it.each(['#section', '/app/settings', './README.md', 'mailto:test@example.com', 'javascript:alert(1)'])(
    'does not offer website actions for %s',
    (url) => {
      renderContent('cherry', url)
      fireEvent.contextMenu(screen.getByText('Example website'))
      expect(screen.queryByRole('menuitem', { name: 'common.link.open_browser' })).not.toBeInTheDocument()
    }
  )

  it.each(['common.copy', 'chat.message.quote', 'common.link.copy'])(
    'preserves both selection and URL actions on a selected link: %s',
    async (action) => {
      const quote = vi.fn().mockResolvedValue(undefined)
      window.api.quoteToMainWindow = quote
      renderContent()
      const linkText = screen.getByText('Example website')
      const range = document.createRange()
      range.selectNodeContents(linkText)
      window.getSelection()?.addRange(range)
      fireEvent.contextMenu(linkText)
      expect(screen.getAllByRole('menuitem')).toHaveLength(5)
      fireEvent.click(screen.getByRole('menuitem', { name: action }))
      if (action === 'chat.message.quote') {
        await waitFor(() => expect(quote).toHaveBeenCalledWith('Example website'))
      } else {
        await waitFor(() =>
          expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            action === 'common.link.copy' ? href : 'Example website'
          )
        )
      }
    }
  )

  it('ignores a selection outside the clicked link', () => {
    renderContent()
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Plain text'))
    window.getSelection()?.addRange(range)
    fireEvent.contextMenu(screen.getByText('Example website'))
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(screen.queryByRole('menuitem', { name: 'chat.message.quote' })).not.toBeInTheDocument()
  })

  it('replaces link actions with selection actions when right-clicking text afterward', async () => {
    const user = userEvent.setup()
    renderContent()
    fireEvent.contextMenu(screen.getByText('Example website'))
    await user.keyboard('{Escape}')
    const text = screen.getByText('Plain text')
    const range = document.createRange()
    range.selectNodeContents(text)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    expect(window.getSelection()?.toString()).toBe('Plain text')
    fireEvent.contextMenu(text)
    expect(screen.queryByRole('menuitem', { name: 'common.link.copy' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'common.copy' }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('Plain text'))
  })
})
