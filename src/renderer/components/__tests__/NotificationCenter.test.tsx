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

  it.each([
    ['assistant', 'prefixed'],
    ['agent', 'prefixed'],
    ['assistant', 'reply-only'],
    ['agent', 'reply-only'],
    ['assistant', 'name-only'],
    ['agent', 'name-only'],
    ['assistant', 'legacy-prefixed'],
    ['agent', 'legacy-prefixed'],
    ['assistant', 'legacy-name-only'],
    ['agent', 'legacy-name-only']
  ] as const)(
    'shows the %s %s success excerpt while keeping failed and scheduled outcomes compact',
    async (source, shape) => {
      const hasReply = shape === 'prefixed' || shape === 'reply-only' || shape === 'legacy-prefixed'
      const message =
        shape === 'reply-only'
          ? 'Brief reply excerpt'
          : hasReply
            ? 'Conversation name to hide\nBrief reply excerpt'
            : 'Conversation name to hide'
      const records: NotificationRecord[] = [
        {
          id: 'c4519cf1-0405-4eb1-a18c-17b263872413',
          eventKey: 'agent-result',
          category: 'system',
          kind: 'task-result',
          title: 'Hidden conversation title',
          message: 'Hidden error details',
          createdAt: Date.now(),
          readAt: null,
          dismissedAt: null,
          target: {
            kind: 'conversation',
            conversationType: 'agent',
            conversationId: 'session',
            result: {
              source: 'agent',
              status: 'failed',
              name: 'Hidden conversation name',
              actor: { name: 'Old agent', emoji: '🍒' },
              durationMs: 12000,
              errorSummary: 'Hidden error details'
            }
          }
        },
        {
          id: 'c4519cf1-0405-4eb1-a18c-17b263872414',
          eventKey: 'assistant-result',
          category: 'system',
          kind: 'queue-completion',
          title: 'Hidden batch count',
          message,
          createdAt: Date.now() - 1000,
          readAt: null,
          dismissedAt: null,
          target: {
            kind: 'conversation',
            conversationType: source,
            conversationId: 'topic',
            ...(shape.startsWith('legacy-') ? {} : { replyPreview: hasReply ? 'Brief reply excerpt' : '' })
          }
        },
        {
          id: 'c4519cf1-0405-4eb1-a18c-17b263872415',
          eventKey: 'scheduled-result',
          category: 'system',
          kind: 'task-result',
          title: 'Hidden result title',
          message: 'Hidden task detail',
          createdAt: Date.now() - 2000,
          readAt: null,
          dismissedAt: null,
          target: {
            kind: 'scheduled-task',
            taskId: 'deleted-task',
            result: { source: 'scheduled-task', status: 'interrupted', name: 'Saved scheduled task' }
          }
        }
      ]
      mockDataApiService.get.mockImplementation(async (path) => {
        if (path === '/notifications') return { items: records }
        if (path === '/notifications/unread-count') return { count: 3 }
        if (path === '/agent-sessions/session') return { agentId: 'agent' }
        if (path === '/agents/agent') return { name: 'Current agent', configuration: { avatar: '🍒' } }
        if (path === '/agent-sessions/topic') return { agentId: 'completed-agent' }
        if (path === '/agents/completed-agent') return { name: 'Completed source', configuration: { avatar: '🍒' } }
        if (path === '/topics/topic') return { assistantId: 'assistant' }
        if (path === '/assistants/assistant') return { name: 'Completed source', emoji: '🤖' }
        throw new Error('Deleted source')
      })
      const user = userEvent.setup()
      render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <NotificationCenterProvider>
            <NotificationCenterButton />
          </NotificationCenterProvider>
        </SWRConfig>
      )
      await user.click(await screen.findByRole('button', { name: /Notification center/ }))
      expect(await screen.findByText('Current agent')).toBeVisible()
      expect(await screen.findByText('Completed source')).toBeVisible()
      expect(await screen.findByText('Saved scheduled task')).toBeVisible()
      for (const label of ['Failed', hasReply ? 'Brief reply excerpt' : 'Completed', 'Interrupted'])
        expect(screen.getByText(label)).toBeVisible()
      expect(screen.queryByText('Old agent')).not.toBeInTheDocument()
      expect(screen.queryByText(/Conversation name to hide/)).not.toBeInTheDocument()
      for (const record of records) {
        const list = screen.getByRole('list', { name: 'Notification center' })
        expect(within(list).queryByText(record.title)).not.toBeInTheDocument()
        if (record.kind !== 'queue-completion') expect(within(list).queryByText(record.message)).not.toBeInTheDocument()
      }
      expect(mockDataApiService.patch).not.toHaveBeenCalled()
    }
  )

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
    const bell = screen.getByRole('button', { name: 'Notification center' })
    expect(item).toHaveAccessibleDescription(readAt === null ? 'Unread' : '')
    expect(bell).toHaveAccessibleDescription(readAt === null ? 'Unread' : '')
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
    await waitFor(() => {
      expect(item).toHaveAccessibleDescription('')
      expect(bell).toHaveAccessibleDescription('')
    })
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
