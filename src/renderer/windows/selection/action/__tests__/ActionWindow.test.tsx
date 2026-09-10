import type * as CherryStudioUi from '@cherrystudio/ui'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ActionWindow from '../ActionWindow'

const { actionState, generalMounts, ipcRequest, opacityPreference, platform } = vi.hoisted(() => ({
  actionState: {
    value: {
      id: 'test-action',
      name: 'Test action',
      icon: 'test-icon',
      isBuiltIn: false
    } as SelectionActionItem
  },
  generalMounts: { count: 0 },
  ipcRequest: vi.fn(),
  opacityPreference: { value: 100 },
  platform: { isMac: false }
}))

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

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest }
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platform.isMac
  }
}))

vi.mock('../components/ActionGeneral', () => {
  const MockActionGeneral = () => {
    useEffect(() => {
      generalMounts.count += 1
    }, [])
    return null
  }
  return { default: MockActionGeneral }
})
vi.mock('../components/ActionTranslate', () => ({ default: () => null }))

describe('ActionWindow surface', () => {
  beforeEach(() => {
    actionState.value = {
      id: 'test-action',
      name: 'Test action',
      icon: 'test-icon',
      isBuiltIn: false
    } as SelectionActionItem
    opacityPreference.value = 100
    platform.isMac = false
    generalMounts.count = 0
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  it('remounts the chat subtree on reuse so the previous selection is not carried over', async () => {
    const { rerender } = render(<ActionWindow />)
    await waitFor(() => expect(generalMounts.count).toBe(1))

    actionState.value = { ...actionState.value, selectedText: 'next selection' }
    rerender(<ActionWindow />)

    await waitFor(() => expect(generalMounts.count).toBe(2))
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
