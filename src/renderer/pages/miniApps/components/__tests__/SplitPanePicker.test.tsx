// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stubApp = (id: string): MiniAppType => ({
  kind: 'site',
  appId: id,
  presetMiniAppId: id as MiniAppType['presetMiniAppId'],
  status: 'pinned',
  orderKey: 'a0',
  name: id,
  url: `https://${id}.example.com`
})

const mocks = vi.hoisted(() => ({
  openMiniAppInSplit: vi.fn(),
  openTab: vi.fn(),
  onClose: vi.fn(),
  miniApps: [] as MiniAppType[]
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

// `pinned` stays empty on purpose: presets seed as `enabled`, so a picker that
// read the launchpad's pinned list would be blank for a fresh install.
vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: mocks.miniApps,
    pinned: [],
    openedKeepAliveMiniApps: [],
    currentMiniAppId: '',
    miniAppShow: false,
    updateAppStatus: vi.fn(),
    hideMiniApp: vi.fn(),
    removeCustomMiniApp: vi.fn()
  })
}))
vi.mock('@renderer/hooks/useSidebarFavorites', () => ({
  useSidebarFavorites: () => ({ miniAppFavoriteIds: [], toggleMiniApp: vi.fn() })
}))
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openMiniAppInSplit: mocks.openMiniAppInSplit })
}))

// The real MiniApp tile falls back to `openTab` when no `onOpen` is supplied,
// navigating the tab away instead of filling the pane; this stub exposes both.
vi.mock('@renderer/components/MiniApp/MiniApp', () => ({
  default: ({
    app,
    onOpen,
    disabled
  }: {
    app: MiniAppType
    onOpen?: (app: MiniAppType, name: string) => void
    disabled?: boolean
  }) => (
    // Mirrors the real tile: `disabled` drops it from the tab order and blocks
    // activation, rather than relying on a pointer-events style.
    <button
      type="button"
      data-testid={`tile-${app.appId}`}
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return
        onOpen ? onOpen(app, app.name) : mocks.openTab()
      }}>
      {app.name}
    </button>
  )
}))

import SplitPanePicker from '../SplitPanePicker'

describe('SplitPanePicker', () => {
  beforeEach(() => {
    mocks.openMiniAppInSplit.mockClear()
    mocks.openTab.mockClear()
    mocks.onClose.mockClear()
    mocks.miniApps = [stubApp('deepseek'), stubApp('kimi')]
  })

  afterEach(cleanup)

  it('fills the split pane with the picked app instead of navigating the tab', () => {
    render(<SplitPanePicker occupiedAppId="deepseek" onClose={mocks.onClose} />)

    fireEvent.click(screen.getByTestId('tile-kimi'))

    // Routing to the mini app (the launchpad's behaviour) would replace the
    // whole tab, tearing down the very split the user just opened.
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.openMiniAppInSplit).toHaveBeenCalledWith(expect.objectContaining({ appId: 'kimi' }))
  })

  it('disables the app already shown in the other pane for pointer and keyboard alike', () => {
    render(<SplitPanePicker occupiedAppId="deepseek" onClose={mocks.onClose} />)

    // One <webview> renders in one place; picking it again would blank a pane, and
    // a pointer-events style alone would leave the tile Enter/Space-activatable.
    const occupied = screen.getByTestId('tile-deepseek')
    expect(occupied).toHaveAttribute('aria-disabled', 'true')
    expect(occupied).toHaveAttribute('tabindex', '-1')

    fireEvent.click(occupied)
    expect(mocks.openMiniAppInSplit).not.toHaveBeenCalled()

    const selectable = screen.getByTestId('tile-kimi')
    expect(selectable).not.toHaveAttribute('aria-disabled')
    expect(selectable).toHaveAttribute('tabindex', '0')
  })

  it('opts back into pointer events so the panel is not inert', () => {
    const { container } = render(<SplitPanePicker occupiedAppId="deepseek" onClose={mocks.onClose} />)

    // MiniAppPage's split container is `pointer-events-none` so clicks reach pooled
    // webviews; without an explicit opt-in the picker inherits it and goes inert.
    expect(container.firstElementChild?.className).toContain('pointer-events-auto')
  })
})
