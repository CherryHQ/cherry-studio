import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConversationTabPreview,
  ConversationTabPreviewProvider,
  ConversationTabStatus
} from '../ConversationTabPreview'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('../ConversationTabPreviewContent', () => ({
  default: ({ onOpen }: { onOpen: () => void }) => (
    <button type="button" onClick={() => onOpen()}>
      Open
    </button>
  )
}))

const tab = { id: 'existing-tab', type: 'route' as const, url: '/app/chat?topicId=background', title: 'Background' }
const key = 'topic.stream.statuses.background' as const
const seenKey = 'topic.stream.last_seen_completion.background' as const

afterEach(cleanup)

describe('ConversationTabPreview', () => {
  it('opens on keyboard focus without acknowledging completion and selects the existing tab only on activation', async () => {
    MockUseCacheUtils.setSharedCacheValue(key, {
      status: 'done',
      lastCompletedAt: 123,
      activeExecutions: [],
      awaitingApprovalAnchors: []
    })
    MockUseCacheUtils.setSharedCacheValue(seenKey, 100)
    const select = vi.fn()
    render(
      <ConversationTabPreviewProvider>
        <ConversationTabPreview tab={tab} isActive={false} disabled={false} onSelect={select}>
          <button type="button">Background</button>
        </ConversationTabPreview>
        <ConversationTabStatus tab={tab} isActive={false} />
      </ConversationTabPreviewProvider>
    )
    fireEvent.focus(screen.getByRole('button', { name: 'Background' }))
    await screen.findByRole('button', { name: 'Open' })
    expect(MockUseCacheUtils.getSharedCacheValue(seenKey)).toBe(100)
    expect(select).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(select).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument())
  })

  it('dismisses an open preview when the tab changes conversation identity', async () => {
    const view = (url: string) => (
      <ConversationTabPreviewProvider>
        <ConversationTabPreview tab={{ ...tab, url }} isActive={false} disabled={false} onSelect={() => {}}>
          <button type="button">Background</button>
        </ConversationTabPreview>
      </ConversationTabPreviewProvider>
    )
    const { rerender } = render(view(tab.url))
    fireEvent.focus(screen.getByRole('button', { name: 'Background' }))
    await screen.findByRole('button', { name: 'Open' })
    rerender(view('/app/chat?topicId=different'))
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
  })

  it('keeps active and dragging tabs free of previews', async () => {
    const { rerender } = render(
      <ConversationTabPreviewProvider>
        <ConversationTabPreview tab={tab} isActive disabled={false} onSelect={() => {}}>
          <button type="button">Background</button>
        </ConversationTabPreview>
      </ConversationTabPreviewProvider>
    )
    fireEvent.focus(screen.getByRole('button', { name: 'Background' }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 550)))
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    rerender(
      <ConversationTabPreviewProvider>
        <ConversationTabPreview tab={tab} isActive={false} disabled onSelect={() => {}}>
          <button type="button">Background</button>
        </ConversationTabPreview>
      </ConversationTabPreviewProvider>
    )
    fireEvent.focus(screen.getByRole('button', { name: 'Background' }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 550)))
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
  })
})
