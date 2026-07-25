import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MessageHeader from '../MessageHeader'

const providerState = vi.hoisted(() => ({
  actions: {} as { selectMessage?: (messageId: string, selected: boolean) => void },
  selection: undefined as { isMultiSelectMode: boolean; selectedMessageIds: string[] } | undefined
}))

vi.mock('@cherrystudio/ui', () => ({
  Avatar: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  AvatarFallback: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  AvatarImage: ({ className }: { className?: string }) => <div className={className} />,
  Checkbox: ({
    className,
    ...props
  }: {
    className?: string
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    [key: string]: unknown
  }) => {
    const domProps = { ...props }
    delete domProps.checked
    delete domProps.onCheckedChange

    return <div className={className} role="checkbox" {...domProps} />
  },
  EmojiAvatar: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/utils/model', () => ({
  getModelLogoRef: () => undefined
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/utils/naming', () => ({
  firstLetter: (value: string) => value.slice(0, 1),
  isEmoji: () => false,
  removeLeadingEmoji: (value: string) => value
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageListActions: () => providerState.actions,
  useMessageListMeta: () => ({
    assistantProfile: undefined,
    userProfile: undefined
  }),
  useMessageListSelection: () => providerState.selection,
  useMessageRenderConfig: () => ({
    userName: 'User',
    messageStyle: 'plain'
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const createMessage = (role: 'assistant' | 'user' = 'assistant', extra: Record<string, unknown> = {}) =>
  ({
    id: 'message-1',
    role,
    createdAt: new Date('2026-06-06T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-06-06T00:00:00.000Z').toISOString(),
    ...extra
  }) as Parameters<typeof MessageHeader>[0]['message']

describe('MessageHeader', () => {
  beforeEach(() => {
    providerState.actions = {}
    providerState.selection = undefined
  })

  it('shows the snapshot assistant name without repeating the model beside it', () => {
    const { getByText, queryByText } = render(
      <MessageHeader
        message={createMessage('assistant', {
          model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai' },
          messageSnapshot: {
            id: 'a1',
            name: 'My Assistant',
            emoji: '🤖',
            model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai' }
          }
        })}
      />
    )
    expect(getByText('My Assistant')).toBeTruthy()
    expect(queryByText('GPT-4')).toBeNull()
  })

  it('shows the model avatar and name beside the assistant when model identity is requested', () => {
    const { getByText } = render(
      <MessageHeader
        showModelIdentity
        message={createMessage('assistant', {
          model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai' },
          messageSnapshot: {
            id: 'a1',
            name: 'My Assistant',
            emoji: '🤖',
            model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai' }
          }
        })}
      />
    )

    expect(getByText('My Assistant')).toBeTruthy()
    expect(getByText('G').closest('[aria-hidden="true"]')).toBeTruthy()
    expect(getByText('GPT-4')).toBeTruthy()
  })

  it('shows the snapshot agent name as primary', () => {
    const { getByText } = render(
      <MessageHeader
        message={createMessage('assistant', {
          model: { id: 'claude', name: 'Claude', provider: 'anthropic' },
          messageSnapshot: {
            id: 'ag1',
            name: 'My Agent',
            model: { id: 'claude', name: 'Claude', provider: 'anthropic' }
          }
        })}
      />
    )
    expect(getByText('My Agent')).toBeTruthy()
  })

  it('marks the real message selection checkbox for drag selection lookup', () => {
    providerState.actions = { selectMessage: vi.fn() }
    providerState.selection = { isMultiSelectMode: true, selectedMessageIds: [] }

    const { container } = render(<MessageHeader message={createMessage()} />)

    expect(container.querySelector('[data-message-select-checkbox]')).not.toBeNull()
  })
})
