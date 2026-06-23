import { fireEvent, render, screen } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

import { QueuedFollowupsDock } from '../QueuedFollowupsDock'

const items = [
  {
    id: '1',
    draft: { text: 'first', tokens: [{ id: 'sk1', kind: 'skill', label: 'mySkill', index: 0, textOffset: 0 }] },
    payload: { text: 'first', userMessageParts: [] }
  },
  { id: '2', draft: { text: 'second', tokens: [] }, payload: { text: 'second', userMessageParts: [] } }
] as any

describe('QueuedFollowupsDock', () => {
  it('renders queued items with token chips and fires the per-item + pause callbacks', () => {
    const onSteer = vi.fn()
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    const onTogglePause = vi.fn()
    const onReorder = vi.fn()

    render(
      <QueuedFollowupsDock
        items={items}
        paused={false}
        onTogglePause={onTogglePause}
        onSteer={onSteer}
        onEdit={onEdit}
        onRemove={onRemove}
        onReorder={onReorder}
      />
    )

    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    // Composer token chip is rendered read-only from the stored draft tokens.
    expect(screen.getByText('mySkill')).toBeInTheDocument()

    fireEvent.click(screen.getAllByLabelText('chat.input.followup_queue.steer')[0])
    expect(onSteer).toHaveBeenCalledWith('1')

    fireEvent.click(screen.getAllByLabelText('chat.input.followup_queue.edit')[1])
    expect(onEdit).toHaveBeenCalledWith('2')

    fireEvent.click(screen.getAllByLabelText('chat.input.followup_queue.remove')[0])
    expect(onRemove).toHaveBeenCalledWith('1')

    fireEvent.click(screen.getByLabelText('chat.input.followup_queue.pause'))
    expect(onTogglePause).toHaveBeenCalled()
  })

  it('renders nothing when the queue is empty', () => {
    const { container } = render(
      <QueuedFollowupsDock
        items={[]}
        paused={false}
        onTogglePause={vi.fn()}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
