// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ComponentPropsWithoutRef, createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    variant,
    size,
    ...props
  }: {
    children?: ReactNode
    variant?: string
    size?: string
    [key: string]: unknown
  }) => {
    void variant
    void size
    return (
      <button type="button" {...props}>
        {children}
      </button>
    )
  },
  EmojiAvatar: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    portalContainer,
    ...props
  }: {
    children?: ReactNode
    portalContainer?: HTMLElement | null
    [key: string]: unknown
  }) => {
    void portalContainer
    return (
      <div data-testid="popover-content" {...props}>
        {children}
      </div>
    )
  },
  PopoverTrigger: ({ children }: { children?: ReactNode; asChild?: boolean }) => <>{children}</>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ size }: { size: number }) => <span data-size={size} data-testid="model-avatar" />
}))

vi.mock('@renderer/components/EmojiPicker', () => ({
  EmojiPicker: () => <div data-testid="emoji-picker" />
}))

import { DialogModelTrigger, EmojiAvatarPicker } from '../DialogFormFields'

afterEach(() => {
  cleanup()
})

describe('DialogModelTrigger', () => {
  it('passes trigger props through to the underlying button for asChild popovers', () => {
    const onClick = vi.fn()
    const Trigger = DialogModelTrigger as unknown as (
      props: ComponentPropsWithoutRef<'button'> & ComponentPropsWithoutRef<typeof DialogModelTrigger>
    ) => ReturnType<typeof DialogModelTrigger>

    render(createElement(Trigger, { ariaLabel: 'Model', displayLabel: 'Pick model', onClick }))

    const trigger = screen.getByRole('button', { name: 'Model' })

    fireEvent.click(trigger)

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('EmojiAvatarPicker', () => {
  it('replaces the avatar with a different random emoji', () => {
    const onChange = vi.fn()
    render(
      <EmojiAvatarPicker
        value="🦊"
        fallback="✨"
        open
        onOpenChange={vi.fn()}
        onChange={onChange}
        ariaLabel="Choose avatar"
        portalContainer={null}
      />
    )

    for (let i = 0; i < 20; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'library.config.dialogs.create.avatar_random' }))
    }

    expect(onChange).toHaveBeenCalledTimes(20)
    for (const [emoji] of onChange.mock.calls) {
      expect(emoji).not.toBe('🦊')
      expect(emoji).toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})
