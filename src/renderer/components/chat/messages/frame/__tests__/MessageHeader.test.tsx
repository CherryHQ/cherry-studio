import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import MessageHeader from '../MessageHeader'

vi.mock('@cherrystudio/ui', () => ({
  Avatar: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  AvatarFallback: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  AvatarImage: ({ className }: { className?: string }) => <div className={className} />,
  Checkbox: ({ className }: { className?: string }) => <div className={className} role="checkbox" />,
  EmojiAvatar: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/config/models', () => ({
  getModelLogo: () => null
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/utils', () => ({
  firstLetter: (value: string) => value.slice(0, 1),
  isEmoji: () => false,
  removeLeadingEmoji: (value: string) => value
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageListActions: () => ({}),
  useMessageListMeta: () => ({
    assistantProfile: undefined,
    userProfile: undefined
  }),
  useMessageListSelection: () => undefined,
  useMessageRenderConfig: () => ({
    userName: 'User',
    messageStyle: 'plain'
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const createMessage = (role: 'assistant' | 'user' = 'assistant') =>
  ({
    id: 'message-1',
    role,
    createdAt: new Date('2026-06-06T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-06-06T00:00:00.000Z').toISOString()
  }) as Parameters<typeof MessageHeader>[0]['message']

describe('MessageHeader', () => {
  it('keeps content and footer in the body column with footer pinned to the bottom', () => {
    const { container } = render(
      <MessageHeader
        message={createMessage()}
        contentSlot={<div className="message-content-container">Content</div>}
        footerSlot={<div className="MessageFooter">Footer</div>}
      />
    )

    const bodyColumn = container.querySelector('.message-body-column')
    const content = container.querySelector('.message-body-content')
    const footerSlot = container.querySelector('.message-footer-slot')
    const footer = container.querySelector('.MessageFooter')

    expect(bodyColumn).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
    expect(content).toHaveClass('min-h-0', 'flex-1')
    expect(footerSlot).toHaveClass('mt-auto', 'shrink-0')
    expect(content?.closest('.message-body-column')).toBe(bodyColumn)
    expect(footer?.closest('.message-body-column')).toBe(bodyColumn)
    expect(footer?.closest('.message-footer-slot')).toBe(footerSlot)
  })

  it('keeps the compact centered header layout when there is no body slot', () => {
    const { container } = render(<MessageHeader message={createMessage()} />)

    const header = container.querySelector('.message-header')

    expect(header).toHaveClass('mb-2', 'items-center')
    expect(container.querySelector('.message-body-column')).toBeNull()
  })
})
