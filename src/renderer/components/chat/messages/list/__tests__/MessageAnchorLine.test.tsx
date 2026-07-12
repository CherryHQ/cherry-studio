// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as MessageTypes from '../../types'
import type { MessageListItem } from '../../types'
import MessageAnchorLine from '../MessageAnchorLine'

vi.mock('@cherrystudio/ui', () => ({
  Avatar: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  AvatarFallback: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
  EmojiAvatar: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, callback: () => void) => callback()
  })
}))

vi.mock('@renderer/utils/model', () => ({
  getModelLogoRef: () => undefined
}))

vi.mock('@renderer/utils/naming', () => ({
  firstLetter: (value: string) => value[0] ?? '',
  isEmoji: () => false,
  removeLeadingEmoji: (value: string) => value
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../../blocks', () => ({
  usePartsMap: () => ({})
}))

vi.mock('../../MessageListProvider', async () => {
  const { defaultMessageRenderConfig } = await vi.importActual<typeof MessageTypes>('../../types')

  return {
    useMessageListActions: () => ({}),
    useMessageListMeta: () => ({}),
    useMessageRenderConfig: () => defaultMessageRenderConfig
  }
})

const messages: MessageListItem[] = [
  {
    id: 'message-1',
    role: 'user',
    topicId: 'topic-1',
    parentId: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    status: 'success'
  }
]

describe('MessageAnchorLine', () => {
  it('keeps the anchor rail scoped inside the message list layer', () => {
    const { container } = render(<MessageAnchorLine messages={messages} />)

    const anchorRail = container.firstElementChild
    expect(anchorRail).toHaveClass('absolute', 'z-20')
    expect(anchorRail).not.toHaveClass('fixed', 'z-999')
  })
})
