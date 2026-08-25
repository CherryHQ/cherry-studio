// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDEBAR_ICON_WIDTH, SIDEBAR_PEEK_WIDTH } from '../../Sidebar'
import { AppSidebarToggleButton } from '../AppSidebarToggleButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const clickToggle = async () => {
  await userEvent.click(screen.getByRole('button'))
}

const sidebarWidth = () => MockUseCacheUtils.getPersistCacheValue('ui.sidebar.width')

describe('AppSidebarToggleButton', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('collapses a visible sidebar out of the way', async () => {
    MockUseCacheUtils.setPersistCacheValue('ui.sidebar.width', 280)

    render(<AppSidebarToggleButton />)
    await clickToggle()

    expect(sidebarWidth()).toBe(0)
  })

  it('restores the width band the sidebar was last expanded to', async () => {
    MockUseCacheUtils.setMultipleCacheValues({
      persist: [
        ['ui.sidebar.width', 0],
        ['ui.sidebar.expanded_width', 280]
      ]
    })

    render(<AppSidebarToggleButton />)
    await clickToggle()

    expect(sidebarWidth()).toBe(280)
  })

  // Without the guard the button reads back a hidden width and leaves the sidebar
  // collapsed, which is the exact dead end the hover-reveal overlay already has.
  it('still expands when the remembered width is itself hidden', async () => {
    MockUseCacheUtils.setMultipleCacheValues({
      persist: [
        ['ui.sidebar.width', 0],
        ['ui.sidebar.expanded_width', 0]
      ]
    })

    render(<AppSidebarToggleButton />)
    await clickToggle()

    expect(sidebarWidth()).toBe(SIDEBAR_ICON_WIDTH)
  })

  // The overlay widens an icon-band memory so its labels stay readable; pinning back
  // to the rail would collapse it under the cursor the moment the user clicks.
  it('pins the hover overlay at the width it is showing', async () => {
    MockUseCacheUtils.setMultipleCacheValues({
      persist: [
        ['ui.sidebar.width', 0],
        ['ui.sidebar.expanded_width', SIDEBAR_ICON_WIDTH]
      ]
    })

    render(<AppSidebarToggleButton peekOpen />)
    await clickToggle()

    expect(sidebarWidth()).toBe(SIDEBAR_PEEK_WIDTH)
  })

  it('keeps the icon rail when expanding without the overlay', async () => {
    MockUseCacheUtils.setMultipleCacheValues({
      persist: [
        ['ui.sidebar.width', 0],
        ['ui.sidebar.expanded_width', SIDEBAR_ICON_WIDTH]
      ]
    })

    render(<AppSidebarToggleButton />)
    await clickToggle()

    expect(sidebarWidth()).toBe(SIDEBAR_ICON_WIDTH)
  })

  // A toggle whose label and pressed state are inverted still passes every click test,
  // so both directions have to be pinned.
  it('announces the action it will perform', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.sidebar.width', 0)

    const { unmount } = render(<AppSidebarToggleButton />)
    expect(screen.getByRole('button')).toHaveAccessibleName('navbar.show_sidebar')
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
    unmount()

    MockUseCacheUtils.setPersistCacheValue('ui.sidebar.width', SIDEBAR_ICON_WIDTH)

    render(<AppSidebarToggleButton />)
    expect(screen.getByRole('button')).toHaveAccessibleName('navbar.hide_sidebar')
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })
})
