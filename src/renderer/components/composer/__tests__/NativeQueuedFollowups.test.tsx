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
