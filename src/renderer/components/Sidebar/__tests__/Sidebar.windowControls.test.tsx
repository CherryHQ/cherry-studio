import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDEBAR_FULL_THRESHOLD } from '../constants'
import { Sidebar } from '../Sidebar'

const platform = vi.hoisted(() => ({ value: 'linux' }))

vi.mock(import('@renderer/utils/platform'), async (importOriginal) => ({
  ...(await importOriginal()),
  get isMac() {
    return platform.value === 'darwin'
  },
  get isLinux() {
    return platform.value === 'linux'
  }
}))

let overlay: EventTarget & { visible: boolean; getTitlebarAreaRect: () => DOMRect }
let titlebarX: number

beforeEach(() => {
  platform.value = 'linux'
  titlebarX = 120
  overlay = Object.assign(new EventTarget(), {
    visible: true,
    getTitlebarAreaRect: () => new DOMRect(titlebarX, 0, 800, 44)
  })
  Object.defineProperty(navigator, 'windowControlsOverlay', { configurable: true, value: overlay })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'windowControlsOverlay')
})

describe('Sidebar window-control clearance', () => {
  it('reserves the leading overlay height and removes it while fullscreen hides the controls', () => {
    const { container } = render(<Sidebar width={SIDEBAR_FULL_THRESHOLD} setWidth={vi.fn()} entries={[]} isFloating />)
    const panel = container.querySelector('.fixed.top-0')

    // The fixed panel must reserve native-control height itself; the AppShell spacer cannot move it.
    expect(panel).toHaveClass('pt-[env(titlebar-area-height)]')

    act(() => {
      overlay.visible = false
      overlay.dispatchEvent(new Event('geometrychange'))
    })
    expect(panel).not.toHaveClass('pt-[env(titlebar-area-height)]')

    act(() => {
      overlay.visible = true
      overlay.dispatchEvent(new Event('geometrychange'))
    })
    expect(panel).toHaveClass('pt-[env(titlebar-area-height)]')

    act(() => {
      titlebarX = 0
      overlay.dispatchEvent(new Event('geometrychange'))
    })
    expect(panel).not.toHaveClass('pt-[env(titlebar-area-height)]')
  })

  it('does not double the clearance for the docked sidebar', () => {
    const { container } = render(<Sidebar width={SIDEBAR_FULL_THRESHOLD} setWidth={vi.fn()} entries={[]} />)

    expect(container.firstElementChild).not.toHaveClass('pt-[env(titlebar-area-height)]')
  })

  it.each([
    ['darwin', true],
    ['win32', false]
  ] as const)('preserves %s clearance without a Linux overlay', (value, hasClearance) => {
    platform.value = value
    Reflect.deleteProperty(navigator, 'windowControlsOverlay')
    const { container } = render(<Sidebar width={SIDEBAR_FULL_THRESHOLD} setWidth={vi.fn()} entries={[]} isFloating />)

    expect(container.querySelector('.fixed.top-0')?.classList.contains('pt-[env(titlebar-area-height)]')).toBe(
      hasClearance
    )
  })
})
