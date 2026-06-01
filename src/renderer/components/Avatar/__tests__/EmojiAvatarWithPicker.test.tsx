import { fireEvent, render, screen } from '@testing-library/react'
import type ReactType from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { EmojiAvatarWithPicker } from '../EmojiAvatarWithPicker'

type PopoverContextValue = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

vi.mock('@renderer/components/EmojiPicker', () => ({
  default: ({ onEmojiClick }: { onEmojiClick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onEmojiClick('📚')}>
      pick emoji
    </button>
  )
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react') as typeof ReactType
  const PopoverContext = React.createContext<PopoverContextValue | null>(null)

  return {
    Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Popover: ({
      children,
      modal,
      open,
      onOpenChange
    }: {
      children: ReactNode
      modal?: boolean
      open: boolean
      onOpenChange: (open: boolean) => void
    }) => (
      <div data-modal={modal} data-testid="popover-root">
        <PopoverContext value={{ open, onOpenChange }}>{children}</PopoverContext>
      </div>
    ),
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const context = React.use(PopoverContext)

      return (
        <div data-testid="popover-trigger" onClick={() => context?.onOpenChange(!context.open)}>
          {children}
        </div>
      )
    },
    PopoverContent: ({
      children,
      align,
      collisionPadding,
      sideOffset
    }: {
      children: ReactNode
      align?: string
      collisionPadding?: number
      sideOffset?: number
    }) => {
      const context = React.use(PopoverContext)

      return context?.open ? (
        <div
          data-align={align}
          data-collision-padding={collisionPadding}
          data-side-offset={sideOffset}
          data-testid="popover-content">
          {children}
        </div>
      ) : null
    }
  }
})

describe('EmojiAvatarWithPicker', () => {
  it('positions the picker as a compact anchored popover', () => {
    render(<EmojiAvatarWithPicker emoji="📁" onPick={vi.fn()} />)

    fireEvent.click(screen.getByTestId('popover-trigger'))

    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-align', 'start')
    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-side-offset', '6')
    expect(screen.getByTestId('popover-content')).toHaveAttribute('data-collision-padding', '16')
    expect(screen.getByTestId('popover-root')).toHaveAttribute('data-modal', 'true')
  })

  it('closes the picker after selecting an emoji', () => {
    const handlePick = vi.fn()
    render(<EmojiAvatarWithPicker emoji="📁" onPick={handlePick} />)

    fireEvent.click(screen.getByTestId('popover-trigger'))
    fireEvent.click(screen.getByRole('button', { name: 'pick emoji' }))

    expect(handlePick).toHaveBeenCalledWith('📚')
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
  })
})
