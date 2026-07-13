import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactModule from 'react'
import { type ReactNode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Capture the close-control props the wizard hands to the UI dialog so the test can
// drive overlay / Esc / pointer-down-outside deterministically (radix's real Esc
// wiring doesn't fire onOpenChange reliably under jsdom).
const dialog = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
  closeOnOverlayClick: undefined as boolean | undefined,
  onPointerDownOutside: undefined as
    | ((event: { defaultPrevented: boolean; preventDefault: () => void }) => void)
    | undefined,
  renderCount: 0,
  mountCount: 0,
  unmountCount: 0,
  settingsNavigate: vi.fn()
}))
const ipc = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: undefined })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipc.request }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/components/EditDialogShared', () => ({
  KnowledgeBaseField: ({ disabled, onOpenKnowledgePage }: { disabled?: boolean; onOpenKnowledgePage?: () => void }) => (
    <button type="button" disabled={disabled} onClick={onOpenKnowledgePage}>
      open knowledge
    </button>
  )
}))

// Only BasicInfoStep needs behavior — it fills the fields that gate navigation.
vi.mock('../steps/BasicInfoStep', () => ({
  BasicInfoStep: ({
    form,
    onSettingsNavigate
  }: {
    form: { setValue: (name: string, value: unknown) => void }
    onSettingsNavigate?: (navigate: () => void) => void
  }) => (
    <>
      <button
        type="button"
        onClick={() => {
          form.setValue('name', 'My Resource')
          form.setValue('modelId', 'provider::model')
        }}>
        fill basic
      </button>
      <button type="button" onClick={() => onSettingsNavigate?.(dialog.settingsNavigate)}>
        open model settings
      </button>
    </>
  )
}))
vi.mock('../steps/PersonaStep', () => ({
  PersonaStep: ({ form }: { form: { setValue: (name: string, value: unknown) => void } }) => (
    <button type="button" onClick={() => form.setValue('prompt', 'be helpful')}>
      fill persona
    </button>
  )
}))
vi.mock('../steps/CapabilityStep', () => ({ CapabilityStep: () => <div /> }))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')
  type TestDialogRef = ((instance: HTMLDivElement | null) => void) | { current: HTMLDivElement | null } | null

  const DialogContent = function DialogContent({
    ref,
    children,
    closeOnOverlayClick,
    onPointerDownOutside
  }: {
    children: ReactNode
    closeOnOverlayClick?: boolean
    onPointerDownOutside?: (event: { defaultPrevented: boolean; preventDefault: () => void }) => void
  } & { ref?: TestDialogRef }) {
    const nodeRef = React.useRef<HTMLDivElement | null>(null)
    dialog.renderCount += 1
    dialog.closeOnOverlayClick = closeOnOverlayClick
    dialog.onPointerDownOutside = onPointerDownOutside

    React.useLayoutEffect(() => {
      if (typeof ref === 'function') {
        ref(null)
        ref(nodeRef.current)
      } else if (ref) {
        ref.current = null
        ref.current = nodeRef.current
      }
    }, [ref])

    return (
      <div ref={nodeRef} role="dialog">
        {children}
      </div>
    )
  }

  return {
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
      React.useEffect(() => {
        dialog.mountCount += 1
        return () => {
          dialog.unmountCount += 1
        }
      }, [])
      dialog.onOpenChange = onOpenChange
      return open ? <div>{children}</div> : null
    },
    DialogContent,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    EmojiAvatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Form: ({ children }: { children: ReactNode }) => <>{children}</>,
    Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
})

import { ResourceCreateWizard } from '../ResourceCreateWizard'

const NEXT = 'library.config.dialogs.create.next'
const CREATE = 'library.config.dialogs.create.submit'
const OPEN_KNOWLEDGE = 'open knowledge'

afterEach(() => {
  cleanup()
  dialog.onOpenChange = undefined
  dialog.closeOnOverlayClick = undefined
  dialog.onPointerDownOutside = undefined
  dialog.renderCount = 0
  ipc.request.mockReset()
  dialog.mountCount = 0
  dialog.unmountCount = 0
  dialog.settingsNavigate.mockReset()
  vi.restoreAllMocks()
})

function mockDeferredAnimationFrames() {
  const callbacks: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.push(callback)
    return callbacks.length
  })

  return {
    pendingCount: () => callbacks.length,
    flushAllFrames: () => {
      while (callbacks.length > 0) {
        const pendingCallbacks = callbacks.splice(0)
        act(() => {
          for (const callback of pendingCallbacks) {
            callback(0)
          }
        })
      }
    }
  }
}

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
    expect(screen.getByRole('button', { name: OPEN_KNOWLEDGE })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: CREATE }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // In flight: overlay click is disabled, pointer-down-outside is prevented, and the
    // dialog and knowledge-page entry refuse to close it — even though the parent's
    // isSubmitting is still false.
    expect(dialog.closeOnOverlayClick).toBe(false)
    expect(screen.getByRole('button', { name: OPEN_KNOWLEDGE })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: OPEN_KNOWLEDGE }))
    expect(ipc.request).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
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
    expect(screen.getByRole('button', { name: OPEN_KNOWLEDGE })).toBeEnabled()
    dialog.onOpenChange?.(false)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('blocks knowledge-page navigation while the parent reports a submit in flight', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn()
    const { rerender } = render(
      <ResourceCreateWizard kind="assistant" open onOpenChange={onOpenChange} onSubmit={onSubmit} />
    )

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    expect(screen.getByRole('button', { name: OPEN_KNOWLEDGE })).toBeEnabled()

    rerender(
      <ResourceCreateWizard kind="assistant" open onOpenChange={onOpenChange} onSubmit={onSubmit} isSubmitting />
    )

    expect(screen.getByRole('button', { name: OPEN_KNOWLEDGE })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: OPEN_KNOWLEDGE }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(ipc.request).not.toHaveBeenCalled()

    rerender(<ResourceCreateWizard kind="assistant" open onOpenChange={onOpenChange} onSubmit={onSubmit} />)
    expect(screen.getByRole('button', { name: OPEN_KNOWLEDGE })).toBeEnabled()
  })

  it('opens a standalone knowledge window and keeps the wizard open', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<ResourceCreateWizard kind="assistant" open onOpenChange={onOpenChange} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    await user.click(screen.getByRole('button', { name: OPEN_KNOWLEDGE }))

    expect(ipc.request).toHaveBeenCalledTimes(1)
    const [channel, payload] = ipc.request.mock.calls[0] as [string, Record<string, unknown>]
    expect(channel).toBe('tab.detach')
    expect(payload).toMatchObject({ url: '/app/knowledge', type: 'route' })
    expect(typeof payload.id).toBe('string')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: OPEN_KNOWLEDGE })).toBeEnabled()
  })

  it('keeps the dialog shell stable when a non-gating field changes after ref attach', async () => {
    const user = userEvent.setup()

    render(<ResourceCreateWizard kind="assistant" open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'fill basic' }))
    await user.click(screen.getByRole('button', { name: NEXT }))
    const renderCountAfterNavigation = dialog.renderCount

    await user.click(screen.getByRole('button', { name: 'fill persona' }))

    expect(dialog.renderCount).toBe(renderCountAfterNavigation)
  })

  it('closes and recreates the dialog before running model settings navigation', async () => {
    function Host() {
      const [open, setOpen] = useState(true)

      return <ResourceCreateWizard kind="assistant" open={open} onOpenChange={setOpen} onSubmit={vi.fn()} />
    }

    render(<Host />)
    const frames = mockDeferredAnimationFrames()
    const mountCountAfterOpen = dialog.mountCount

    await userEvent.click(screen.getByRole('button', { name: 'open model settings' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(dialog.unmountCount).toBeGreaterThan(0)
    expect(dialog.mountCount).toBeGreaterThan(mountCountAfterOpen)
    expect(dialog.settingsNavigate).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })
    expect(frames.pendingCount()).toBeGreaterThan(0)
    frames.flushAllFrames()

    expect(dialog.settingsNavigate).toHaveBeenCalledTimes(1)
  })
})
