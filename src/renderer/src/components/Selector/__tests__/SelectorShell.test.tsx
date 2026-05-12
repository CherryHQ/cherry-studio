import { render, waitFor } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openAutoFocusEvents } = vi.hoisted(() => ({
  openAutoFocusEvents: [] as Array<{ preventDefault: ReturnType<typeof vi.fn>; defaultPrevented: boolean }>
}))

vi.mock('@cherrystudio/ui', () => ({
  Input: ({ ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: RefObject<HTMLInputElement | null> }) => (
    <input ref={ref} {...props} />
  ),
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({
    children,
    onOpenAutoFocus,
    align,
    side,
    sideOffset,
    onInteractOutside,
    ...props
  }: {
    children: ReactNode
    onOpenAutoFocus?: (event: { preventDefault: () => void; defaultPrevented: boolean }) => void
    align?: string
    side?: string
    sideOffset?: number
    onInteractOutside?: unknown
  }) => {
    void align
    void side
    void sideOffset
    void onInteractOutside
    const event = {
      preventDefault: vi.fn(() => {
        event.defaultPrevented = true
      }),
      defaultPrevented: false
    }
    openAutoFocusEvents.push(event)
    onOpenAutoFocus?.(event)
    return <div {...props}>{children}</div>
  },
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Switch: () => <button type="button" role="switch" />
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

import { SelectorShell } from '../shell/SelectorShell'

describe('SelectorShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    openAutoFocusEvents.length = 0
  })

  it('does not force focus into search when search autoFocus is false', async () => {
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search',
          autoFocus: false
        }}>
        <div />
      </SelectorShell>
    )

    await waitFor(() => expect(openAutoFocusEvents).toHaveLength(1))
    expect(openAutoFocusEvents[0]?.preventDefault).not.toHaveBeenCalled()
    expect(focusSpy).not.toHaveBeenCalled()
  })
})
