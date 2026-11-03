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

  it('uses the snapshot image instead of the live avatar', async () => {
    class LoadedImage {
      complete = true
      naturalWidth = 1
      src = ''
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal('Image', LoadedImage)
    providerState.meta = {
      assistantProfile: { name: 'Live', avatar: 'file:///live.webp' },
      assistantAvatarSources: new Map([['file:frozen', 'file:///frozen.webp']])
    }
    try {
      render(
        <MessageHeader
          message={createMessage('assistant', {
            messageSnapshot: { id: 'a1', name: 'Frozen', emoji: '🎓', avatarFileId: 'file:frozen' }
          })}
        />
      )
      const image = await screen.findByRole('img')
      expect(image).toHaveAttribute('src', 'file:///frozen.webp')
      fireEvent.error(image)
      expect(screen.getAllByText('🎓')[0]).toBeVisible()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to the frozen emoji when its file is missing', () => {
    providerState.meta = { assistantProfile: { name: 'Live', avatar: 'file:///live.webp' } }
    render(
      <MessageHeader
        message={createMessage('assistant', {
          messageSnapshot: { id: 'a1', name: 'Frozen', emoji: '🎓', avatarFileId: 'file:missing' }
        })}
      />
    )
    expect(screen.getAllByText('🎓')[0]).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('uses the live avatar when the message has no snapshot', async () => {
    class LoadedImage {
      complete = true
      naturalWidth = 1
      src = ''
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal('Image', LoadedImage)
    providerState.meta = { assistantProfile: { name: 'Live', avatar: 'file:///live.webp' } }
    try {
      render(<MessageHeader message={createMessage()} />)
      expect(await screen.findByRole('img')).toHaveAttribute('src', 'file:///live.webp')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('explains a runtime-started assistant turn with its origin', () => {
    // A goal round has no user message above it; the badge is the transcript's only explanation.
    const { getByText } = render(
      <MessageHeader message={createMessage('assistant', { turnOrigin: { kind: 'goal-round', round: 2 } })} />
    )
    expect(getByText('Goal round 2')).toBeTruthy()
  })

  it('renders no badge for a background continuation', () => {
    const { queryByText } = render(
      <MessageHeader message={createMessage('assistant', { turnOrigin: { kind: 'background-work' } })} />
    )
    expect(queryByText(/Goal round/)).toBeNull()
    expect(queryByText('agent.session_turn_origin.background_work')).toBeNull()
  })

  it('shows durable sender attribution without transport status on a received message', () => {
    const sender = { agentId: 'agent-a', sessionId: 'session-a' }
    const { getByText } = render(
      <MessageHeader
        message={createMessage('user', {
          delivery: {
            version: 1,
            sender,
            receiver: { agentId: 'agent-b', sessionId: 'session-b' },
            senderSnapshot: { agentName: 'Agent A', sessionName: 'Research' },
            receiverSnapshot: { agentName: 'Agent B', sessionName: 'Build' },
            replyPolicy: 'none',
            turnRef: null,
            sourceMessageId: null,
            outcome: null,
            error: null,
            statusAt: '2026-06-06T00:00:01.000Z',
            status: 'accepted',
            inReplyTo: null
          }
        })}
      />
    )

    expect(getByText('From Agent A / Research')).toBeTruthy()
  })

  it('opens the sending session from durable attribution', async () => {
    const user = userEvent.setup()
    const navigateToRoute = vi.fn()
    providerState.actions = { navigateToRoute }

    render(
      <MessageHeader
        message={createMessage('user', {
          delivery: {
            version: 1,
            sender: { agentId: 'agent-a', sessionId: 'session-source' },
            receiver: { agentId: 'agent-b', sessionId: 'session-current' },
            senderSnapshot: { agentName: 'Agent A', sessionName: 'Research' },
            receiverSnapshot: { agentName: 'Agent B', sessionName: 'Build' },
            replyPolicy: 'none',
            turnRef: null,
            sourceMessageId: null,
            outcome: null,
            error: null,
            statusAt: '2026-06-06T00:00:01.000Z',
            status: 'accepted',
            inReplyTo: null
          }
        })}
      />
    )

    await user.click(screen.getByRole('button', { name: /From Agent A \/ Research/ }))

    expect(navigateToRoute).toHaveBeenCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-source' }
    })
  })
})
