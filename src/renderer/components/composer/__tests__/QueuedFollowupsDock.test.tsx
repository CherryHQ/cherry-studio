import { fireEvent, render, screen, within } from '@testing-library/react'
import type * as LucideReact from 'lucide-react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<typeof LucideReact>()),
  ArrowUp: () => <span data-testid="arrow-up-icon" />
}))

import { QueuedFollowupsDock } from '../QueuedFollowupsDock'

const items = [
  {
    id: '1',
    draft: {
      text: 'first https://example.com/docs',
      tokens: [
        { id: 'sk1', kind: 'skill', label: 'mySkill', index: 0, textOffset: 0 },
        {
          id: 'link-token-1',
          kind: 'link',
          label: 'example.com/docs',
          promptText: 'https://example.com/docs',
          index: 1,
          textOffset: 6
        }
      ]
    },
    payload: { text: 'first https://example.com/docs', userMessageParts: [] }
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

    const { container } = render(
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
    expect(screen.queryByText('first https://example.com/docs')).not.toBeInTheDocument()
    // Composer token chip is rendered read-only from the stored draft tokens.
    expect(container.querySelector('[data-composer-token-kind="skill"]')).toHaveTextContent('mySkill')
    expect(container.querySelector('[data-composer-token-kind="link"]')).toHaveTextContent('example.com/docs')
    expect(screen.getByRole('link', { name: 'https://example.com/docs' }).parentElement).toHaveClass('mt-1')
    for (const steerButton of screen.getAllByLabelText('chat.input.followup_queue.steer')) {
      expect(within(steerButton).getByTestId('arrow-up-icon')).toBeInTheDocument()
    }

    fireEvent.click(screen.getAllByLabelText('chat.input.followup_queue.steer')[0])
    expect(onSteer).toHaveBeenCalledWith('1')

    fireEvent.click(screen.getAllByLabelText('chat.input.followup_queue.edit')[1])
    expect(onEdit).toHaveBeenCalledWith('2')

    fireEvent.click(screen.getAllByLabelText('chat.input.followup_queue.remove')[0])
    expect(onRemove).toHaveBeenCalledWith('1')

    fireEvent.click(screen.getByLabelText('chat.input.followup_queue.pause'))
    expect(onTogglePause).toHaveBeenCalled()
  })

  it('renders a token-only draft without repeating its prompt text or reserving text spacing', () => {
    const url = 'https://example.com/docs'
    const { container } = render(
      <QueuedFollowupsDock
        items={[
          {
            id: 'link-only',
            draft: {
              text: url,
              tokens: [
                {
                  id: 'link-token',
                  kind: 'link',
                  label: 'example.com/docs',
                  promptText: url,
                  index: 0,
                  textOffset: 0
                }
              ]
            },
            payload: { text: url, userMessageParts: [] }
          }
        ]}
        paused={false}
        onTogglePause={vi.fn()}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    const linkToken = screen.getByRole('link', { name: url })
    expect(screen.queryByText(url)).not.toBeInTheDocument()
    expect(linkToken).toHaveTextContent('example.com/docs')
    expect(linkToken.parentElement).not.toHaveClass('mt-1')
    expect(container.querySelector('[data-composer-token-kind="link"]')).toBe(linkToken)
  })

  it('keeps draft prose when a token prompt no longer matches its recorded offset', () => {
    const text = 'user edited this queued message'
    render(
      <QueuedFollowupsDock
        items={[
          {
            id: 'stale-token',
            draft: {
              text,
              tokens: [
                {
                  id: 'link-token',
                  kind: 'link',
                  label: 'example.com/docs',
                  promptText: 'https://example.com/docs',
                  index: 0,
                  textOffset: 0
                }
              ]
            },
            payload: { text, userMessageParts: [] }
          }
        ]}
        paused={false}
        onTogglePause={vi.fn()}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeInTheDocument()
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
