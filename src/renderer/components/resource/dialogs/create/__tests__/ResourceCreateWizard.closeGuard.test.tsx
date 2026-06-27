import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Capture the close-control props the wizard hands to the UI dialog so the test can
// drive overlay / Esc / pointer-down-outside deterministically (radix's real Esc
// wiring doesn't fire onOpenChange reliably under jsdom).
const dialog = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
  closeOnOverlayClick: undefined as boolean | undefined,
  onPointerDownOutside: undefined as
    | ((event: { defaultPrevented: boolean; preventDefault: () => void }) => void)
    | undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// Only BasicInfoStep needs behavior — it fills the fields that gate navigation.
vi.mock('../steps/BasicInfoStep', () => ({
  BasicInfoStep: ({ form }: { form: { setValue: (name: string, value: unknown) => void } }) => (
    <button
      type="button"
      onClick={() => {
        form.setValue('name', 'My Resource')
        form.setValue('modelId', 'provider::model')
      }}>
      fill basic
    </button>
  )
}))
vi.mock('../steps/PersonaStep', () => ({ PersonaStep: () => <div /> }))
vi.mock('../steps/KnowledgeStep', () => ({ KnowledgeStep: () => <div /> }))
vi.mock('../steps/CapabilityStep', () => ({ CapabilityStep: () => <div /> }))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  // Forward only the props the test exercises; drop loading/variant/size/className so they
  // neither hit the DOM nor sit as unused destructured vars (CI oxlint flags those).
  Button: ({
    children,
    type = 'button',
    onClick,
    disabled
  }: {
    children: ReactNode
    type?: 'button' | 'submit' | 'reset'
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Dialog: ({
    open,
    onOpenChange,
    children
  }: {
    open: boolean
    onOpenChange?: (open: boolean) => void
    children: ReactNode
  }) => {
    dialog.onOpenChange = onOpenChange
    return open ? <div>{children}</div> : null
  },
  DialogContent: ({
    children,
    closeOnOverlayClick,
    onPointerDownOutside
  }: {
    children: ReactNode
    closeOnOverlayClick?: boolean
    onPointerDownOutside?: (event: { defaultPrevented: boolean; preventDefault: () => void }) => void
  }) => {
    dialog.closeOnOverlayClick = closeOnOverlayClick
    dialog.onPointerDownOutside = onPointerDownOutside
    return <div role="dialog">{children}</div>
  },
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  EmojiAvatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Form: ({ children }: { children: ReactNode }) => <>{children}</>,
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

import { ResourceCreateWizard } from '../ResourceCreateWizard'

const NEXT = 'library.config.dialogs.create.next'
const CREATE = 'library.config.dialogs.create.submit'

afterEach(cleanup)

describe('ResourceCreateWizard close protection', () => {
  it('blocks overlay / Esc close while a submit is in flight, then releases once it settles', async () => {
    const user = userEvent.setup()
    let resolveSubmit: () => void = () => {}
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    const onSubmit = vi.fn(() => submitPromise)
    const onOpenChange = vi.fn()

    render(<ResourceCreateWizard kind="assistant" open onOpenChange={onOpenChange} onSubmit={onSubmit} />)

    // Walk to the final step and start the (still pending) submit.
    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: CREATE }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // In flight: overlay click is disabled, pointer-down-outside is prevented, and the
    // dialog refuses to forward a close — even though the parent's isSubmitting is still false.
    expect(dialog.closeOnOverlayClick).toBe(false)
    let prevented = false
    dialog.onPointerDownOutside?.({ defaultPrevented: false, preventDefault: () => (prevented = true) })
    expect(prevented).toBe(true)
    dialog.onOpenChange?.(false)
    expect(onOpenChange).not.toHaveBeenCalled()

    // Once the submit settles, close protection releases.
    await act(async () => {
      resolveSubmit()
      await submitPromise
    })
    expect(dialog.closeOnOverlayClick).toBe(true)
    dialog.onOpenChange?.(false)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
