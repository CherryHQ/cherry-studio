// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stubApp = (id: string): MiniAppType => ({
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

vi.mock('@renderer/components/app/sidebarIcons', () => ({
  SIDEBAR_ICON_COMPONENTS: { assistants: () => <span data-testid="icon-assistants" /> },
  APP_ICON_BACKGROUNDS: { assistants: 'linear-gradient(#000, #111)' }
}))

vi.mock('@renderer/utils/sidebar', () => ({ getSidebarMenuPath: () => '/app/chat' }))
vi.mock('@renderer/i18n/label', () => ({ getSidebarIconLabelKey: (id: string) => id }))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => ['default-provider'] }))
vi.mock('@renderer/hooks/useLaunchpadAppOrder', () => ({
  useLaunchpadAppOrder: () => ({ orderedAppIds: ['assistants'] })
}))
// `pinned` stays empty on purpose: presets seed as `enabled`, so a picker that
// read the launchpad's pinned list would be blank for a fresh install.
vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({ miniApps: mocks.miniApps, pinned: [] })
}))
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openMiniAppInSplit: mocks.openMiniAppInSplit })
}))

// The real MiniApp tile falls back to `openTab` when no `onOpen` is supplied —
// which would navigate the whole tab away instead of filling the split pane.
// This stub exposes both paths so the wiring is observable.
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
    expect(mocks.openMiniAppInSplit).toHaveBeenCalledWith(expect.objectContaining({ appId: 'kimi' }), 'kimi')
  })

  it('disables the app already shown in the other pane for pointer and keyboard alike', () => {
    render(<SplitPanePicker occupiedAppId="deepseek" onClose={mocks.onClose} />)

    // One <webview> renders in one place; picking it again would blank a pane.
    // A pointer-events style alone would still leave the tile focusable and
    // activatable with Enter/Space.
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

    // MiniAppPage's split container is `pointer-events-none` so clicks reach the
    // pooled webviews through it. Without an explicit opt-in here the whole
    // picker inherits that and nothing in it can be clicked.
    expect(container.firstElementChild?.className).toContain('pointer-events-auto')
  })

  it('renders built-in apps as non-interactive until they are supported', () => {
    const { container } = render(<SplitPanePicker occupiedAppId="deepseek" onClose={mocks.onClose} />)

    // Built-in apps are routed pages — they need a second router to live in a
    // pane, so they are shown but must not be clickable.
    const appsGrid = container.querySelector('[data-testid="icon-assistants"]')?.closest('.grid') as HTMLElement
    expect(appsGrid.className).toContain('pointer-events-none')
  })
})
