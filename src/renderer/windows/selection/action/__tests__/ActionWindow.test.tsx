import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { ReadTextAloudInput } from '@renderer/services/voice/manualPlayback'
import type { SelectionActionSession } from '@shared/types/selection'

import ActionWindow from '../ActionWindow'

const { actionState, ipcRequest, opacityPreference, platform, readAloud, dismissalListeners } = vi.hoisted(() => ({
  actionState: {
    value: {
      id: 'test-action',
      name: 'Test action',
      icon: 'test-icon',
      isBuiltIn: false,
      sessionId: 'session-1'
    } as SelectionActionSession
  },
  ipcRequest: vi.fn(),
  opacityPreference: { value: 100 },
  platform: { isMac: false },
  readAloud: vi.fn<(input: ReadTextAloudInput) => Promise<void>>(async () => undefined),
  dismissalListeners: new Set<(payload: { sessionId: string }) => void>()
}))

vi.mock('@renderer/services/voice', () => ({
  readTextAloud: readAloud
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

vi.mock('@renderer/components/selection/SelectionActionIcon', () => ({
  default: ({ size }: { size: number }) => <span data-testid="action-icon" data-size={size} />
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Pick<typeof CherryStudioUi, 'Slider'>>()

  return {
    Button: ({ children, ...props }: PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Slider: actual.Slider,
    Tooltip: ({ children }: PropsWithChildren) => children
  }
})

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'feature.selection.action_window_opacity') return [opacityPreference.value]
    return [false]
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => actionState.value
}))

vi.mock('@renderer/ipc', async () => {
  const { useEffect } = await import('react')
  return {
    ipcApi: { request: ipcRequest },
    useIpcOn: (_event: string, listener: (payload: { sessionId: string }) => void) => {
      useEffect(() => {
        dismissalListeners.add(listener)
        return () => {
          dismissalListeners.delete(listener)
        }
      }, [listener])
    }
  }
})

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platform.isMac
  }
}))

vi.mock('../components/ActionGeneral', async () => {
  const { ResultReadAloudButton } = await import('../components/ResultReadAloudButton')
  return {
    default: ({ sourceEntityId }: { sourceEntityId: string }) => (
      <ResultReadAloudButton text="generated result" sourceEntityId={sourceEntityId} />
    )
  }
})
vi.mock('../components/ActionTranslate', () => ({ default: () => null }))

describe('ActionWindow surface', () => {
  beforeEach(() => {
    actionState.value = {
      id: 'test-action',
      name: 'Test action',
      icon: 'test-icon',
      isBuiltIn: false,
      sessionId: 'session-1'
    } as SelectionActionSession
    opacityPreference.value = 100
    platform.isMac = false
    readAloud.mockClear()
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  it('cancels the hidden or replaced session without cancelling a later pooled session', async () => {
    actionState.value = { ...actionState.value, selectedText: 'PRIVATE_SELECTION_1' }
    const view = render(<ActionWindow />)
    fireEvent.click(screen.getByRole('button', { name: 'selection.action.voice.read_result' }))
    const first = readAloud.mock.calls.at(-1)![0].signal!
    expect(first.aborted).toBe(false)
    act(() => dismissalListeners.forEach((listener) => listener({ sessionId: 'session-1' })))
    expect(first.aborted).toBe(true)

    actionState.value = { ...actionState.value, selectedText: 'PRIVATE_SELECTION_2', sessionId: 'session-2' }
    view.rerender(<ActionWindow />)
    fireEvent.click(screen.getByRole('button', { name: 'selection.action.voice.read_result' }))
    const second = readAloud.mock.calls.at(-1)![0].signal!
    act(() => dismissalListeners.forEach((listener) => listener({ sessionId: 'session-1' })))
    expect(second.aborted).toBe(false)

    actionState.value = { ...actionState.value, sessionId: 'session-3' }
    view.rerender(<ActionWindow />)
    expect(second.aborted).toBe(true)
  })

  it('uses an opaque popover surface at 100% window opacity', () => {
    const { container } = render(<ActionWindow />)
    const windowFrame = container.firstElementChild

    expect(windowFrame).toHaveClass('bg-popover')
    expect(windowFrame).not.toHaveClass('bg-background')
    expect(windowFrame).toHaveStyle({ opacity: '1' })
  })

  it('lets the action body shrink so long result content cannot blow out the panel', () => {
    // Contract: the overflow-hidden shell clips descendants unless every flex
    // child between it and the result can shrink below min-content width.
    const { container } = render(<ActionWindow />)
    const windowFrame = container.firstElementChild
    const bodyScroller = windowFrame?.querySelector(':scope > .overflow-auto')
    const content = bodyScroller?.firstElementChild

    expect(windowFrame).toHaveClass('overflow-hidden')
    expect(bodyScroller).toHaveClass('min-w-0')
    expect(content).toHaveClass('min-w-0', 'flex-1')
  })

  it('keeps applying the configured opacity below 100%', () => {
    opacityPreference.value = 60

    const { container } = render(<ActionWindow />)

    expect(container.firstElementChild).toHaveStyle({ opacity: '0.6' })
  })

  it('leaves additional title spacing after the macOS traffic lights', () => {
    platform.isMac = true

    const { container } = render(<ActionWindow />)
    const titleBar = container.firstElementChild?.firstElementChild

    expect(titleBar).toHaveStyle({ paddingLeft: '78px' })
  })

  it('uses compact title-bar icons and a neutral pinned state', () => {
    const { container } = render(<ActionWindow />)

    expect(screen.getByTestId('action-icon')).toHaveAttribute('data-size', '14')
    expect(container.querySelector('.lucide-pin')).toHaveClass('size-[13px]')
    expect(container.querySelector('.lucide-droplet')).toHaveClass('size-[13px]')
    expect(container.querySelector('.lucide-minus')).toHaveClass('size-3.5')
    expect(container.querySelector('.lucide-x')).toHaveClass('size-3.5')

    const pinButton = container.querySelector('.lucide-pin')?.closest('button')
    fireEvent.click(pinButton!)

    expect(pinButton).toHaveClass('bg-accent', 'text-accent-foreground', 'hover:bg-accent')
    expect(pinButton).not.toHaveClass('bg-primary/10', 'text-primary')
    expect(container.querySelector('.lucide-pin')).toHaveClass('text-accent-foreground')

    const opacityButton = container.querySelector('.lucide-droplet')?.closest('button')
    fireEvent.click(opacityButton!)

    expect(opacityButton).toHaveClass('bg-accent', 'text-accent-foreground', 'hover:bg-accent')
    expect(opacityButton).not.toHaveClass('bg-primary/10', 'text-primary')
    const opacitySlider = container.querySelector('[data-slot="slider"]')

    expect(opacitySlider).toHaveClass('data-[orientation=vertical]:min-h-0')
    expect(opacitySlider).not.toHaveClass('data-[orientation=vertical]:min-h-44')
  })

  it('resets transient state when a pooled window reuses the same action type', async () => {
    const { container, rerender } = render(<ActionWindow />)
    const pinButton = container.querySelector('.lucide-pin')?.closest('button')
    const opacityButton = container.querySelector('.lucide-droplet')?.closest('button')

    fireEvent.click(pinButton!)
    fireEvent.click(opacityButton!)
    expect(pinButton).toHaveClass('bg-accent')
    expect(container.querySelector('[data-slot="slider"]')).toBeInTheDocument()

    vi.mocked(HTMLElement.prototype.scrollTo).mockClear()
    ipcRequest.mockClear()
    opacityPreference.value = 60
    actionState.value = { ...actionState.value, selectedText: 'next selection' }
    rerender(<ActionWindow />)

    await waitFor(() => {
      expect(container.querySelector('[data-slot="slider"]')).not.toBeInTheDocument()
      expect(pinButton).not.toHaveClass('bg-accent')
    })
    expect(container.firstElementChild).toHaveStyle({ opacity: '0.6' })
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith({ top: 0 })
    expect(ipcRequest).toHaveBeenCalledWith('selection.pin_action_window', false)
  })
})
