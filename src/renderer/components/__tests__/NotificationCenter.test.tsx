import { MockDataApiUtils, mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getI18n } from 'react-i18next'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotificationRecord } from '@shared/data/types/notification'

import { NotificationCenterButton } from '../NotificationCenter'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')

describe('NotificationCenter reading', () => {
  beforeEach(async () => {
    MockDataApiUtils.resetMocks()
    vi.clearAllMocks()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: undefined })
    await getI18n().changeLanguage('en-us')
  })

  it.each([null, 1])('only persists unread announcements (readAt=%s)', async (readAt) => {
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
      target: { kind: 'announcement', content: 'Full announcement details', url: 'https://example.com/news' }
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
        <NotificationCenterButton />
      </SWRConfig>
    )
    await user.click(await screen.findByRole('button', { name: 'Notification center' }))
    const item = await screen.findByRole('button', { name: record.title })
    await user.click(item)
    expect(await screen.findByText('Full announcement details')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('system.shell.open_website', 'https://example.com/news')
    await user.click(item)
    await waitFor(() => expect(screen.queryByText('Full announcement details')).not.toBeInTheDocument())
    await user.click(item)
    expect(await screen.findByText('Full announcement details')).toBeVisible()
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
