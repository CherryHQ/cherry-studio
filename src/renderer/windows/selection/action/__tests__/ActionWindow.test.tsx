import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ActionWindow from '../ActionWindow'

const { opacityPreference, platform } = vi.hoisted(() => ({
  opacityPreference: { value: 100 },
  platform: { isMac: false }
}))

const action = {
  id: 'test-action',
  name: 'Test action',
  icon: 'test-icon',
  isBuiltIn: false
} as SelectionActionItem

vi.mock('@renderer/components/selection/SelectionActionIcon', () => ({
  default: ({ size }: { size: number }) => <span data-testid="action-icon" data-size={size} />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Slider: () => null,
  Tooltip: ({ children }: PropsWithChildren) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'feature.selection.action_window_opacity') return [opacityPreference.value]
    return [false]
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => action
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platform.isMac
  }
}))

vi.mock('../components/ActionGeneral', () => ({ default: () => null }))
vi.mock('../components/ActionTranslate', () => ({ default: () => null }))

describe('ActionWindow surface', () => {
  beforeEach(() => {
    opacityPreference.value = 100
    platform.isMac = false
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  it('uses an opaque popover surface at 100% window opacity', () => {
    const { container } = render(<ActionWindow />)
    const windowFrame = container.firstElementChild

    expect(windowFrame).toHaveClass('bg-popover')
    expect(windowFrame).not.toHaveClass('bg-background')
    expect(windowFrame).toHaveStyle({ opacity: '1' })
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

    expect(pinButton).toHaveClass('bg-accent', 'text-foreground', 'hover:bg-accent')
    expect(pinButton).not.toHaveClass('bg-primary/10', 'text-primary')
    expect(container.querySelector('.lucide-pin')).toHaveClass('text-foreground')

    const opacityButton = container.querySelector('.lucide-droplet')?.closest('button')
    fireEvent.click(opacityButton!)

    expect(opacityButton).toHaveClass('bg-accent', 'text-foreground', 'hover:bg-accent')
    expect(opacityButton).not.toHaveClass('bg-primary/10', 'text-primary')
  })
})
