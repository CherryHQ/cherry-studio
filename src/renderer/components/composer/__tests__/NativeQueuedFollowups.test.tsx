import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type * as CherryUI from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { AGENT_SESSION_FOLLOWUPS_CACHE_KEY, type AgentSessionFollowup } from '@shared/ai/agentSessionFollowups'

import { NativeQueuedFollowups } from '../NativeQueuedFollowups'

vi.unmock('@renderer/data/hooks/useCache')

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryUI>()),
  ReorderableList: ({
    items,
    onDragStateChange,
    onReorder
  }: {
    items: { id: string }[]
    onDragStateChange?: (dragging: boolean) => void
    onReorder: (next: { id: string }[]) => void
  }) => (
    <>
      <button type="button" onClick={() => onDragStateChange?.(true)}>
        Start drag
      </button>
      <button
        type="button"
        onClick={() => {
          onDragStateChange?.(false)
          const [first, second, third, fourth] = items
          onReorder([second, third, first, fourth])
        }}>
        Drop third
      </button>
    </>
  )
}))

it('rejects a drop computed from a queue changed in another window, and allows a fresh drag', async () => {
  const request = vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: true })
  await i18n.changeLanguage('en-US')
  const user = userEvent.setup()
  const topicId = 'agent-session:session'
  const key = AGENT_SESSION_FOLLOWUPS_CACHE_KEY(topicId)
  const queue = (ids: string[]): AgentSessionFollowup[] =>
    ids.map((id) => ({ id, revision: 0, parts: [{ type: 'text', text: id }] }))
  cacheService.setShared(key, queue(['A', 'B', 'C', 'D']))
  render(<NativeQueuedFollowups topicId={topicId} />)
  await user.click(screen.getByRole('button', { name: 'Queued (4)' }))
  await user.click(screen.getByRole('button', { name: 'Start drag' }))
  act(() => cacheService.setShared(key, queue(['A', 'C', 'D', 'B'])))
  await user.click(screen.getByRole('button', { name: 'Drop third' }))

  expect(request).not.toHaveBeenCalled()
  expect(toast.warning).toHaveBeenCalledWith('The queue changed. Check the current queue and try again.')

  await user.click(screen.getByRole('button', { name: 'Start drag' }))
  await user.click(screen.getByRole('button', { name: 'Drop third' }))
  expect(request).toHaveBeenCalledExactlyOnceWith('ai.agent.session.change_followups', {
    topicId,
    change: { type: 'reorder', before: ['A', 'C', 'D', 'B'], after: ['C', 'D', 'A', 'B'] }
  })
})

it('renders host-queued fallback items read-only in the existing dock without native edit or remove actions', async () => {
  await i18n.changeLanguage('en-US')
  const user = userEvent.setup()
  const topicId = 'agent-session:host-fallback'
  cacheService.setShared(AGENT_SESSION_FOLLOWUPS_CACHE_KEY(topicId), [
    { id: 'host-1', revision: 0, source: 'host', parts: [{ type: 'text', text: 'Fallback queued item' }] } as any
  ])

  render(<NativeQueuedFollowups topicId={topicId} />)

  await user.click(screen.getByRole('button', { name: 'Queued (1)' }))
  expect(screen.getByText('Fallback queued item')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
})

it('sends a native-only reorder from a dock containing a host fallback', async () => {
  const request = vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: true })
  await i18n.changeLanguage('en-US')
  const user = userEvent.setup()
  const topicId = 'agent-session:mixed-queue'
  cacheService.setShared(
    AGENT_SESSION_FOLLOWUPS_CACHE_KEY(topicId),
    ['A', 'B', 'C', 'host'].map((id) => ({
      id,
      revision: 0,
      parts: [{ type: 'text', text: id }],
      ...(id === 'host' && { source: 'host' })
    }))
  )
  render(<NativeQueuedFollowups topicId={topicId} />)
  await user.click(screen.getByRole('button', { name: 'Queued (4)' }))
  await user.click(screen.getByRole('button', { name: 'Start drag' }))
  await user.click(screen.getByRole('button', { name: 'Drop third' }))

  expect(request).toHaveBeenCalledExactlyOnceWith('ai.agent.session.change_followups', {
    topicId,
    change: { type: 'reorder', before: ['A', 'B', 'C'], after: ['B', 'C', 'A'] }
  })
})
