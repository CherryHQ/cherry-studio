import { MockDataApiUtils, mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getI18n } from 'react-i18next'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotificationRecord } from '@shared/data/types/notification'

import { NotificationCenterButton, NotificationCenterProvider } from '../NotificationCenter'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')

describe('NotificationCenter reading', () => {
  beforeEach(async () => {
    MockDataApiUtils.resetMocks()
    vi.clearAllMocks()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: undefined })
    await getI18n().changeLanguage('en-us')
  })

  it('shows only an unread dot and closes on toggle, Escape and outside pointer interaction without marking read', async () => {
    mockDataApiService.get.mockImplementation(async (path) =>
      path === '/notifications' ? { items: [] } : { count: 120 }
    )
    const user = userEvent.setup()
    const outside = vi.fn()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NotificationCenterProvider>
          <NotificationCenterButton />
          <button type="button" onClick={outside}>
            Outside action
          </button>
        </NotificationCenterProvider>
      </SWRConfig>
    )
    const bell = await screen.findByRole('button', { name: /Notification center/ })
    await user.click(bell)
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.queryByText('120')).not.toBeInTheDocument()
    expect(screen.queryByText('99+')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="drawer-overlay"]')).toBeNull()
    expect(mockDataApiService.patch).not.toHaveBeenCalled()
    await user.click(bell)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(bell)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(bell)
    await user.click(screen.getByRole('button', { name: 'Outside action' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(outside).toHaveBeenCalledOnce()
    expect(mockDataApiService.patch).not.toHaveBeenCalled()
  })

  it.each([null, 1])('only persists unread announcements (readAt=%s)', async (readAt) => {
    const content =
      '**中文** 😀\n<b>Full announcement details</b>\n[link](https://example.com)\n' + '完整公告内容。'.repeat(30)
    const record: NotificationRecord = {
      id: 'c4519cf1-0405-4eb1-a18c-17b263872413',
      eventKey: 'announcement:reading',
      category: 'official',
      kind: 'announcement',
      title: 'Product announcement',
      message: 'Announcement preview',
      createdAt: 1,
      readAt,
      dismissedAt: null,
      target: { kind: 'announcement', content, url: 'https://example.com/news' }
    }
    mockDataApiService.get.mockImplementation(async (path) =>
      path === '/notifications' ? { items: [{ ...record }] } : { count: record.readAt === null ? 1 : 0 }
    )
    mockDataApiService.patch.mockImplementation(async () => {
      record.readAt = 2
    })
    const user = userEvent.setup()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NotificationCenterProvider>
          <NotificationCenterButton />
        </NotificationCenterProvider>
      </SWRConfig>
    )
    await user.click(await screen.findByRole('button', { name: 'Notification center' }))
    const item = await screen.findByRole('button', { name: record.title })
    expect(item).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(record.message)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    const previewText = content
    const preview = within(item).getByText(previewText, { normalizer: (text) => text })
    // The collapsed preview fades; expansion must remove this mask in place.
    expect(preview).toHaveClass('[mask-image:linear-gradient(to_bottom,black_75%,transparent)]')
    await user.click(item)
    const body = await within(item).findByText(content, { normalizer: (text) => text })
    expect(body).toBeVisible()
    expect(item).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText(content, { normalizer: (text) => text })).toHaveLength(1)
    expect(body).not.toHaveClass('[mask-image:linear-gradient(to_bottom,black_75%,transparent)]')
    expect(body.textContent).toBe(content)
    expect(screen.queryByRole('link', { name: 'link' })).not.toBeInTheDocument()
    // Preserving line breaks is part of the announcement text contract.
    expect(body).toHaveClass('whitespace-pre-wrap')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('system.shell.open_website', 'https://example.com/news')
    await user.click(item)
    await waitFor(() => expect(item).toHaveAttribute('aria-expanded', 'false'))
    expect(item).toHaveAttribute('aria-expanded', 'false')
    expect(within(item).getByText(previewText, { normalizer: (text) => text })).toBeVisible()
    await user.click(item)
    expect(await screen.findByText(content, { normalizer: (text) => text })).toBeVisible()
    expect(record.readAt).not.toBeNull()
    expect(mockDataApiService.patch).toHaveBeenCalledTimes(readAt === null ? 1 : 0)
    if (readAt === null) {
      expect(mockDataApiService.patch).toHaveBeenCalledWith(`/notifications/${record.id}`, {
        body: { read: true },
        query: undefined
      })
    }
  })
})
