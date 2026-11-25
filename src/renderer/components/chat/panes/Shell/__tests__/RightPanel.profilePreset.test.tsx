import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as MotionModule from 'motion/react'
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

import { installCacheApiMock } from '../../../../../data/hooks/__tests__/testUtils'

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipSurface: ({ children }: PropsWithChildren) => <>{children}</>
}))
vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children, onClick, 'aria-label': label }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button type="button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}))
vi.mock('@renderer/components/icons/SidebarToggleIcons', () => ({ RightSidebarCollapseIcon: () => <span /> }))
vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))
// Motion caches the reduced-motion media query per module, so each test picks it explicitly.
const motionPreference = vi.hoisted(() => ({ reduce: true }))
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof MotionModule>()),
  useReducedMotion: () => motionPreference.reduce
}))
vi.mock('@renderer/hooks/command', () => ({ useCommandHandler: () => undefined }))
vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => true }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

// The width contract lives in the real persisted cache tier and the width Motion writes.
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

import {
  type RightPanelCapability,
  RightPanelProvider,
  RightPanelViewport,
  useRightPanelActions,
  useRightPanelState
} from '../RightPanel'

const PROFILE_KEY = 'ui.chat.profile_pane.width'
const INSPECTOR_KEY = 'ui.chat.artifact_pane.width'
const MAIN_REGION_WIDTH = 1600

const capabilities = [
  {
    component: () => <div>files content</div>,
    resolve: () => ({ id: 'files', instanceKey: 'files', title: 'Files', readiness: 'ready', canMaximize: true })
  },
  {
    component: () => <div>profile content</div>,
    widthPreset: 'profile',
    resolve: () => ({
      id: 'profile',
      instanceKey: 'profile',
      title: 'Profile',
      readiness: 'ready',
      headerMode: 'content',
      canMaximize: false
    })
  }
] satisfies readonly RightPanelCapability<object>[]

const scope = {}

function Controls() {
  const actions = useRightPanelActions()
  const state = useRightPanelState()
  return (
    <>
      <output data-testid="maximized">{String(state.presentationMaximized)}</output>
      <button type="button" onClick={() => actions.tryOpen('files')}>
        open files
      </button>
      <button type="button" onClick={() => actions.tryOpen('profile')}>
        open profile
      </button>
      <button type="button" onClick={actions.close}>
        close
      </button>
    </>
  )
}

function Harness() {
  return (
    <RightPanelProvider capabilities={capabilities} scope={scope}>
      <Controls />
      <div className="relative" data-main-region>
        <RightPanelViewport />
      </div>
    </RightPanelProvider>
  )
}

const handle = () => screen.getByRole('separator')
const spacer = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-right-pane-spacer]') as HTMLElement

describe('profile right-pane width', () => {
  beforeEach(() => {
    installCacheApiMock()
    cacheService.setPersist(PROFILE_KEY, 360)
    cacheService.setPersist(INSPECTOR_KEY, 280)
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, MAIN_REGION_WIDTH, 800))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens at 360, resizes only between 300 and 440, and remembers its own width', async () => {
    motionPreference.reduce = true
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'open profile' }))
    await waitFor(() => expect(handle()).toHaveAttribute('aria-valuenow', '360'))
    expect(handle()).toHaveAttribute('aria-valuemin', '300')
    expect(handle()).toHaveAttribute('aria-valuemax', '440')

    fireEvent.keyDown(handle(), { key: 'End' })
    expect(cacheService.getPersist(PROFILE_KEY)).toBe(440)
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(cacheService.getPersist(PROFILE_KEY)).toBe(440)
    fireEvent.keyDown(handle(), { key: 'Home' })
    expect(cacheService.getPersist(PROFILE_KEY)).toBe(300)
    // The inspector panes keep the width they had.
    expect(cacheService.getPersist(INSPECTOR_KEY)).toBe(280)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    fireEvent.click(screen.getByRole('button', { name: 'open profile' }))
    await waitFor(() => expect(handle()).toHaveAttribute('aria-valuenow', '300'))
  })

  it('travels the slot width from one preset to the other instead of snapping', async () => {
    motionPreference.reduce = false
    const { container } = render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'open files' }))
    await waitFor(() => expect(spacer(container).style.width).toBe('280px'), { timeout: 2000 })

    const pane = container.querySelector<HTMLElement>('[data-right-pane]') as HTMLElement
    const spacerWidths: string[] = []
    const paneWidths: string[] = []
    const observer = new MutationObserver(() => {
      spacerWidths.push(spacer(container).style.width)
      paneWidths.push(pane.style.width)
    })
    observer.observe(container, { attributes: true, attributeFilter: ['style'], subtree: true })

    fireEvent.click(screen.getByRole('button', { name: 'open profile' }))
    await waitFor(() => expect(spacer(container).style.width).toBe('360px'), { timeout: 2000 })
    await waitFor(() => expect(pane.style.width).toContain('min(360px'), { timeout: 2000 })
    observer.disconnect()

    // Both edges pass through in-between widths on the way, rather than jumping to the new preset.
    const between = (width: string) => parseFloat(width) > 280 && parseFloat(width) < 360
    expect(spacerWidths.some(between)).toBe(true)
    expect(paneWidths.some((width) => between(width.replace(/^max\(min\(/, '')))).toBe(true)
  })

  it('restores the normal layout when the profile opens over a maximized pane', async () => {
    motionPreference.reduce = true
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'open files' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'common.maximize' }))
    })
    expect(screen.getByTestId('maximized')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'open profile' }))

    expect(screen.getByTestId('maximized')).toHaveTextContent('false')
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()
  })
})
