import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListActions, MessageListItem } from '../../types'
import MessageGroupMenuBar from '../MessageGroupMenuBar'

const mocks = vi.hoisted(() => ({
  actions: {} as MessageListActions,
  partsMap: {} as Record<string, Array<{ type: string; [key: string]: unknown }>>,
  t: vi.fn((...args: [key: string, options?: unknown]) => args[0])
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentPropsWithoutRef<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  RowFlex: ({ children, className }: ComponentPropsWithoutRef<'div'>) => <div className={className}>{children}</div>,
  Tooltip: ({ children, content }: { children: ReactNode; content?: ReactNode }) => (
    <span data-tooltip-content={typeof content === 'string' ? content : undefined}>{children}</span>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t
  })
}))

vi.mock('../../blocks/MessagePartsContext', () => ({
  usePartsMap: () => mocks.partsMap
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageListActions: () => mocks.actions
}))

vi.mock('../MessageGroupModelList', () => ({
  default: () => null
}))

vi.mock('../MessageGroupSettings', () => ({
  default: () => null
}))

const messages = [
  {
    id: 'assistant-1',
    parentId: 'user-1',
    role: 'assistant',
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success'
  } as MessageListItem,
  {
    id: 'assistant-2',
    parentId: 'user-1',
    role: 'assistant',
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:01.000Z',
    status: 'success'
  } as MessageListItem
]

describe('MessageGroupMenuBar', () => {
  beforeEach(() => {
    mocks.actions = {}
    mocks.partsMap = {}
    mocks.t.mockClear()
  })

  it('routes group deletion through confirm capability', () => {
    const deleteMessageGroupWithConfirm = vi.fn()
    mocks.actions = { deleteMessageGroupWithConfirm }

    render(
      <MessageGroupMenuBar
        multiModelMessageStyle="horizontal"
        setMultiModelMessageStyle={vi.fn()}
        messages={messages}
        selectMessageId="assistant-1"
        setSelectedMessage={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button'))

    expect(deleteMessageGroupWithConfirm).toHaveBeenCalledWith(['assistant-1', 'assistant-2'])
  })

  it('does not expose group deletion when only direct delete capability exists', () => {
    mocks.actions = { deleteMessageGroup: vi.fn() }

    render(
      <MessageGroupMenuBar
        multiModelMessageStyle="horizontal"
        setMultiModelMessageStyle={vi.fn()}
        messages={messages}
        selectMessageId="assistant-1"
        setSelectedMessage={vi.fn()}
      />
    )

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('disables group deletion while a reply in the group is still generating', () => {
    const deleteMessageGroupWithConfirm = vi.fn()
    mocks.actions = {
      deleteMessageGroupWithConfirm,
      getMessageDeleteAvailability: vi.fn((id) =>
        id === 'assistant-2' ? ({ enabled: false, reason: 'generating' } as const) : ({ enabled: true } as const)
      )
    }
    const transmittingMessages = [messages[0], { ...messages[1], status: 'pending' } as MessageListItem]

    render(
      <MessageGroupMenuBar
        multiModelMessageStyle="horizontal"
        setMultiModelMessageStyle={vi.fn()}
        messages={transmittingMessages}
        selectMessageId="assistant-1"
        setSelectedMessage={vi.fn()}
      />
    )

    const deleteButton = screen.getByRole('button')
    expect(deleteButton).toBeDisabled()
    expect(deleteButton.parentElement).toHaveAttribute('data-tooltip-content', 'message.delete.generating_unavailable')
    fireEvent.click(deleteButton)
    expect(deleteMessageGroupWithConfirm).not.toHaveBeenCalled()
  })

  it.each([
    ['not-loaded', 'message.delete.root_unavailable'],
    ['generating', 'message.delete.generating_unavailable']
  ] as const)('disables group deletion for %s', (reason, tooltip) => {
    mocks.actions = {
      deleteMessageGroupWithConfirm: vi.fn(),
      getMessageDeleteAvailability: vi.fn(() => ({ enabled: false, reason }))
    }

    render(
      <MessageGroupMenuBar
        multiModelMessageStyle="horizontal"
        setMultiModelMessageStyle={vi.fn()}
        messages={messages}
        selectMessageId="assistant-1"
        setSelectedMessage={vi.fn()}
      />
    )

    const deleteButton = screen.getByRole('button')
    expect(deleteButton).toBeDisabled()
    expect(deleteButton.parentElement).toHaveAttribute('data-tooltip-content', tooltip)
  })

  it('does not offer Retry All for successful non-text replies', () => {
    mocks.actions = { regenerateMessage: vi.fn() }
    mocks.partsMap = {
      'assistant-1': [{ type: 'data-code', data: { content: 'const ok = true', language: 'ts' } }],
      'assistant-2': [{ type: 'text', text: 'complete' }]
    }

    render(
      <MessageGroupMenuBar
        multiModelMessageStyle="horizontal"
        setMultiModelMessageStyle={vi.fn()}
        messages={messages}
        selectMessageId="assistant-1"
        setSelectedMessage={vi.fn()}
      />
    )

    expect(document.querySelector('[data-tooltip-content="message.group.retry_failed"]')).toBeNull()
  })

  it('retries at most one failed reply per model with deterministic selection', async () => {
    const user = userEvent.setup()
    const regenerateMessage = vi.fn().mockResolvedValue(undefined)
    const notifyInfo = vi.fn()
    mocks.actions = { regenerateMessage, notifyInfo }
    const failedMessages = [
      {
        ...messages[0],
        id: 'gpt-selected-old',
        status: 'error',
        modelId: 'openai::gpt-4o',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        ...messages[0],
        id: 'gpt-new',
        status: 'error',
        modelId: 'openai::gpt-4o',
        createdAt: '2026-01-01T00:00:03.000Z'
      },
      {
        ...messages[0],
        id: 'gpt-legacy',
        status: 'error',
        modelId: 'openai::openai::gpt-4o',
        persistedModelId: null,
        model: { id: 'openai::gpt-4o', name: 'GPT-4o', provider: 'openai' },
        createdAt: '2026-01-01T00:00:02.500Z'
      },
      {
        ...messages[0],
        id: 'claude-old',
        status: 'paused',
        modelId: 'anthropic::claude-sonnet',
        createdAt: '2026-01-01T00:00:01.000Z'
      },
      {
        ...messages[0],
        id: 'claude-new',
        status: 'error',
        modelId: 'anthropic::claude-sonnet',
        createdAt: '2026-01-01T00:00:02.000Z'
      }
    ] as MessageListItem[]

    render(
      <MessageGroupMenuBar
        multiModelMessageStyle="horizontal"
        setMultiModelMessageStyle={vi.fn()}
        messages={failedMessages}
        selectMessageId="gpt-selected-old"
        setSelectedMessage={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'message.group.retry_failed' }))

    expect(regenerateMessage.mock.calls).toEqual([['gpt-selected-old'], ['claude-new']])
    expect(notifyInfo).toHaveBeenCalledWith('message.group.retry_skipped_same_model')
    expect(mocks.t).toHaveBeenCalledWith('message.group.retry_skipped_same_model', { count: 3 })
  })
})
