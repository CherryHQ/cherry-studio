// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isMac: true }))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platformState.isMac
  },
  isWin: false,
  isLinux: false
}))
vi.mock('@renderer/components/layout/SubWindowControls', () => ({
  SubWindowControls: () => <div data-testid="sub-window-controls" />
}))
vi.mock('@renderer/components/layout/SubWindowTitle', () => ({
  SubWindowTitle: () => <div data-testid="sub-window-title" />
}))

import { SubWindowTitleBar } from '../SubWindowTitleBar'

afterEach(() => {
  platformState.isMac = true
})

describe('SubWindowTitleBar', () => {
  it('reserves the macOS traffic-light area when not fullscreen', () => {
    const { container } = render(<SubWindowTitleBar isFullscreen={false} />)

    const header = container.querySelector('header')
    expect(header).toHaveClass('pl-[env(titlebar-area-x)]')
    expect(header).not.toHaveClass('pl-2')
  })

  it('falls back to the plain inset in fullscreen, where the traffic lights are hidden', () => {
    const { container } = render(<SubWindowTitleBar isFullscreen />)

    const header = container.querySelector('header')
    expect(header).toHaveClass('pl-2')
    expect(header).not.toHaveClass('pl-[env(titlebar-area-x)]')
  })

  it('uses the plain inset on non-macOS platforms', () => {
    platformState.isMac = false
    const { container } = render(<SubWindowTitleBar isFullscreen={false} />)

    const header = container.querySelector('header')
    expect(header).toHaveClass('pl-2')
    expect(header).not.toHaveClass('pl-[env(titlebar-area-x)]')
  })
})
