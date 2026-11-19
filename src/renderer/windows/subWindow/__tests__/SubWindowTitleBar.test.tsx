// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isMac: true, isWin: false }))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platformState.isMac
  },
  get isWin() {
    return platformState.isWin
  },
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
  platformState.isWin = false
})

describe('SubWindowTitleBar', () => {
  it('reserves native overlay height on Windows and releases it in fullscreen', () => {
    platformState.isMac = false
    platformState.isWin = true
    const { container, rerender } = render(<SubWindowTitleBar isFullscreen={false} />)
    expect(container.querySelector('header')?.style.minHeight).toBe('env(titlebar-area-height, 0px)')
    rerender(<SubWindowTitleBar isFullscreen />)
    expect(container.querySelector('header')?.style.minHeight).toBe('')
  })
})
