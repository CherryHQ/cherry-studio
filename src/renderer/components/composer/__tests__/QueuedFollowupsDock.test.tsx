import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { installDndDomStubs } from '@cherrystudio/ui/components/composites/sortable/__tests__/dnd-dom-stubs'
import i18n from '@renderer/i18n/resolver'

vi.unmock('@cherrystudio/ui')

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

const knowledgePrompt = 'The user attached knowledge base "Notes" (id: kb-1) — use that id with the kb_* tools.'

const knowledgeItem = {
  id: 'knowledge',
  draft: {
    text: `${knowledgePrompt} what is in it?`,
    tokens: [
      {
        id: 'knowledge:kb-1',
        kind: 'knowledge',
        label: 'Notes',
        promptText: knowledgePrompt,
        index: 0,
        textOffset: 0
      }
    ]
  },
  payload: { text: `${knowledgePrompt} what is in it?`, userMessageParts: [] }
} as any

describe('QueuedFollowupsDock', () => {
  beforeAll(installDndDomStubs)

  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('keeps folded actions out of keyboard navigation and toggles from the focused header', async () => {
    const user = userEvent.setup()
    const onTogglePause = vi.fn()
    render(
      <QueuedFollowupsDock
        items={items}
        paused={false}
        onTogglePause={onTogglePause}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
      />
    )
    const toggle = screen.getByRole('button', { name: 'Queued (2)' })
    expect(screen.queryByRole('button', { name: 'steer' })).not.toBeInTheDocument()
    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('[Enter]')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByText('second')).toBeVisible())
    expect(screen.getAllByRole('button', { name: 'steer' })).toHaveLength(2)
    await user.keyboard('[Space]')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'steer' })).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Pause auto-send' })).toHaveFocus()
    expect(onTogglePause).not.toHaveBeenCalled()
  })
  it('starts collapsed, updates the count while folded, and preserves items when toggled', async () => {
    const user = userEvent.setup()
    const props = {
      items,
      paused: false,
      onTogglePause: vi.fn(),
      onSteer: vi.fn(),
      onEdit: vi.fn(),
      onRemove: vi.fn(),
      onReorder: vi.fn()
    }
    const { rerender } = render(<QueuedFollowupsDock {...props} />)
    const toggle = screen.getByRole('button', { name: 'Queued (2)' })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('first')).not.toBeVisible()
    expect(screen.getByText('second')).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Pause auto-send' }))
    expect(props.onTogglePause).toHaveBeenCalledOnce()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    rerender(<QueuedFollowupsDock {...props} items={[items[1]]} paused />)
    expect(toggle).toHaveAccessibleName('Queued (1)')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByText('second')).toBeVisible())
    expect(screen.queryByText('first')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume auto-send' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    await waitFor(() => expect(screen.getByText('second')).not.toBeVisible())
    await user.click(toggle)
    await waitFor(() => expect(screen.getByText('second')).toBeVisible())
    expect(props.onSteer).not.toHaveBeenCalled()
    expect(props.onEdit).not.toHaveBeenCalled()
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(props.onReorder).not.toHaveBeenCalled()
  })

  it('renders queued items with token chips and fires the per-item + pause callbacks', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: 'Queued (2)' }))
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.queryByText('first https://example.com/docs')).not.toBeInTheDocument()
    // Composer token chip is rendered read-only from the stored draft tokens.
    expect(container.querySelector('[data-composer-token-kind="skill"]')).toHaveTextContent('mySkill')
    expect(container.querySelector('[data-composer-token-kind="link"]')).toHaveTextContent('example.com/docs')

    await user.click(screen.getAllByLabelText('steer')[0])
    expect(onSteer).toHaveBeenCalledWith('1')

    await user.click(screen.getAllByLabelText('Edit')[1])
    expect(onEdit).toHaveBeenCalledWith('2')

    await user.click(screen.getAllByLabelText('Remove')[0])
    expect(onRemove).toHaveBeenCalledWith('1')

    await user.click(screen.getByLabelText('Pause auto-send'))
    expect(onTogglePause).toHaveBeenCalled()
  })

  it('disables manual steer for a reserved branch while its caller reports the stream as live', async () => {
    const user = userEvent.setup()
    const onSteer = vi.fn()
    const reservedItem = {
      ...items[0],
      payload: {
        ...items[0].payload,
        chatTarget: { parentAnchorId: 'reserved-user', mode: 'reserved-branch' }
      }
    }

    render(
      <QueuedFollowupsDock
        items={[reservedItem]}
        paused={false}
        onTogglePause={vi.fn()}
        onSteer={onSteer}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
        isSteerDisabled={(item) => item.payload.chatTarget?.mode === 'reserved-branch'}
        steerDisabledReason="wait for current"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Queued (1)' }))
    const steerButton = screen.getByLabelText('steer')
    expect(steerButton).toBeDisabled()
    await user.click(steerButton)
    expect(onSteer).not.toHaveBeenCalled()
  })

  it('renders a token-only draft without repeating its prompt text or reserving text spacing', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: 'Queued (1)' }))
    const linkToken = screen.getByRole('link', { name: url })
    expect(screen.queryByText(url)).not.toBeInTheDocument()
    expect(linkToken).toHaveTextContent('example.com/docs')
    expect(container.querySelector('[data-composer-token-kind="link"]')).toBe(linkToken)
  })

  it('keeps draft prose when a token prompt no longer matches its recorded offset', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: 'Queued (1)' }))
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

  it('hides a knowledge token prompt while keeping the user text and chip', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <QueuedFollowupsDock
        items={[knowledgeItem]}
        paused={false}
        onTogglePause={vi.fn()}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Queued (1)' }))
    expect(container).toHaveTextContent('what is in it?')
    expect(container.querySelector('[data-composer-token-kind="knowledge"]')).toHaveTextContent('Notes')
    expect(container).not.toHaveTextContent(knowledgePrompt)
    expect(container).not.toHaveTextContent('kb-1')
  })
})
