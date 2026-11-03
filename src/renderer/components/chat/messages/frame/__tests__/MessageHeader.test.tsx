import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'
import type * as Naming from '@renderer/utils/naming'

import type { MessageListMeta } from '../../types'
import MessageHeader from '../MessageHeader'

const providerState = vi.hoisted(() => ({
  actions: {} as {
    navigateToRoute?: (target: { path: string; query?: Record<string, string> }) => void
    selectMessage?: (messageId: string, selected: boolean) => void
  },
  selection: undefined as { isMultiSelectMode: boolean; selectedMessageIds: string[] } | undefined,
  meta: {} as Partial<MessageListMeta>
}))

vi.mock('@cherrystudio/ui', async (original) => {
  const actual = await original<typeof Ui>()
  return {
    Avatar: actual.Avatar,
    AvatarFallback: actual.AvatarFallback,
    AvatarImage: actual.AvatarImage,
    EmojiIcon: actual.EmojiIcon,
    Badge: ({ asChild, children }: { asChild?: boolean; children?: ReactNode }) =>
      asChild ? <>{children}</> : <span>{children}</span>,
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
  }
})

vi.mock('@renderer/utils/model', () => ({
  getModelLogoRef: () => undefined
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/utils/naming', async (original) => ({
  firstLetter: (value: string) => value.slice(0, 1),
  isEmoji: (await original<typeof Naming>()).isEmoji,
  removeLeadingEmoji: (value: string) => value
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageListActions: () => providerState.actions,
  useOptionalMessageListActions: () => providerState.actions,
  useMessageListMeta: () => ({
    assistantProfile: undefined,
    userProfile: undefined,
    ...providerState.meta
  }),
  useMessageListSelection: () => providerState.selection,
  useMessageRenderConfig: () => ({
    userName: 'User',
    messageStyle: 'plain'
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { agent?: string; session?: string; round?: number }) => {
      if (key === 'agent.session_delivery.from') return `From ${values?.agent} / ${values?.session}`
      if (key === 'agent.session_turn_origin.goal_round') return `Goal round ${values?.round}`
      return key
    }
  })
}))

const createMessage = (role: 'assistant' | 'user' | 'system' = 'assistant', extra: Record<string, unknown> = {}) =>
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
    providerState.meta = {}
  })

  it('attributes historical system records to the system instead of the user', () => {
    render(<MessageHeader message={createMessage('system')} />)
    expect(screen.getByText('chat.message.system')).toBeInTheDocument()
    expect(screen.queryByText('User')).not.toBeInTheDocument()
  })

