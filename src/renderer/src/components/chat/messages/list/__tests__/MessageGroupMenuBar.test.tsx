import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListActions, MessageListItem } from '../../types'
import MessageGroupMenuBar from '../MessageGroupMenuBar'

const mocks = vi.hoisted(() => ({
  actions: {} as MessageListActions
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentPropsWithoutRef<'button'>) => <button {...props}>{children}</button>,
  RowFlex: ({ children, className }: ComponentPropsWithoutRef<'div'>) => <div className={className}>{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../blocks', () => ({
  usePartsMap: () => ({})
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
  } as MessageListItem
]

describe('MessageGroupMenuBar', () => {
  beforeEach(() => {
    mocks.actions = {}
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

    expect(deleteMessageGroupWithConfirm).toHaveBeenCalledWith('user-1')
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
})
