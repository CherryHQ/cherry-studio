import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { DefaultRendererPersistCache } from '@shared/data/cache/cacheSchemas'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { Activity, useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  CHAT_CENTER_MIN_USABLE_WIDTH,
  getRightPaneWidthPolicy
} from '../paneLayout'
import { PersistentRightPaneHost, RightPaneHost } from '../RightPaneHost'

const persistCacheMock = vi.hoisted(() => {
  const state = { width: 280, byKey: {} as Record<string, number>, windowByKey: {} as Record<string, number> }

  return {
    state,
    setWidth: vi.fn((width: number) => {
      state.width = width
    }),
    setByKey: vi.fn((key: string, width: number) => {
      state.byKey[key] = width
    }),
    setWindowByKey: vi.fn((key: string, width: number) => {
      state.windowByKey[key] = width
    })
  }
})

const motionTestState = vi.hoisted(() => ({
  controls: {
    set: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn()
  },
  reducedMotion: true
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: vi.fn((key: string, initialValue: number) => [
    persistCacheMock.state.windowByKey[key] ?? initialValue,
    (width: number) => persistCacheMock.setWindowByKey(key, width)
  ]),
  usePersistCache: vi.fn((key: string) => [
    persistCacheMock.state.byKey[key] ?? persistCacheMock.state.width,
    (width: number) => {
      persistCacheMock.setByKey(key, width)
      persistCacheMock.setWidth(width)
    }
  ])
}))

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  onAnimationComplete?: () => void
  transition?: unknown
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, onAnimationComplete, ...props }: MotionDivProps) => {
      const domProps = { ...props }
      delete domProps.animate
      delete domProps.exit
      delete domProps.initial
      delete domProps.transition

      return (
        <div {...domProps} onAnimationEnd={onAnimationComplete}>
          {children}
        </div>
      )
    }
  },
  // Real motion returns one stable controls instance per component; a fresh object
  // per render would re-run the host's cleanup effect and cancel in-flight phases.
  useAnimationControls: () => motionTestState.controls,
  useReducedMotion: () => motionTestState.reducedMotion
}))

const LIST_POLICY = getRightPaneWidthPolicy('navigation-list')
const INSPECTOR_POLICY = getRightPaneWidthPolicy('inspector')

function mockMainRegionWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    return this.parentElement
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-main-region') ? new DOMRect(0, 0, width, 500) : new DOMRect()
  })
}

function ActivityRightPaneHarness({
  visible,
  maximized = false,
  onLayoutAnimationComplete
}: {
  visible: boolean
  maximized?: boolean
  onLayoutAnimationComplete?: (mode: 'closed' | 'docked' | 'maximized') => void
}) {
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <PersistentRightPaneHost
        open
        maximized={maximized}
        width={460}
        onLayoutAnimationComplete={onLayoutAnimationComplete}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    </Activity>
  )
}

/**
 * ResizeObserver fake that only notifies observers actually watching the resized target, so a
 * test fails when production forgets to observe a node it depends on.
 */
class TargetTrackingResizeObserver {
  static instances: TargetTrackingResizeObserver[] = []
  readonly targets = new Set<Element>()

  constructor(readonly callback: () => void) {
    TargetTrackingResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }
}

function installTargetTrackingResizeObserver() {
  const original = globalThis.ResizeObserver
  TargetTrackingResizeObserver.instances = []
  globalThis.ResizeObserver = TargetTrackingResizeObserver as unknown as typeof ResizeObserver
  restoreResizeObserver = () => {
    globalThis.ResizeObserver = original
    TargetTrackingResizeObserver.instances = []
  }
}

/** Notifies only the observers that are watching `target`, mirroring a real resize. */
function resizeTarget(target: Element) {
  for (const observer of TargetTrackingResizeObserver.instances) {
    if (observer.targets.has(target)) observer.callback()
  }
}

/**
 * Mirrors the shell nesting the composer really sits in — shell root > main region > center >
 * dock frame — so a mutation watch has to descend to notice a composer arriving.
 */
function createShellRoot() {
  const shell = document.createElement('div')
  shell.setAttribute('data-chat-app-shell-root', '')
  const region = document.createElement('div')
  const center = document.createElement('div')
  const composerHost = document.createElement('div')
  const mount = document.createElement('div')
  center.append(composerHost)
  region.append(center, mount)
  shell.append(region)
  document.body.append(shell)
  return { composerHost, mount, shell }
}

function createComposerSurface() {
  const surface = document.createElement('div')
  surface.setAttribute('data-composer-dock-surface', '')
  return surface
}

let restoreResizeObserver: (() => void) | null = null

/** Gives the absolutely positioned pane the containing block and rect jsdom never computes. */
function prepareMeasuredPane(container: HTMLElement) {
  const pane = container.querySelector<HTMLElement>('[data-right-pane]')
  const region = pane?.parentElement
  if (!pane || !region) throw new Error('pane not mounted')
  Object.defineProperty(pane, 'offsetParent', { configurable: true, get: () => region })
  stubRect(region, { top: 0, bottom: 800 })
}

function stubRect(element: HTMLElement, { top, bottom }: { top: number; bottom: number }) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom,
    height: bottom - top,
    left: 0,
    right: 0,
    top,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect)
}

describe('RightPaneHost', () => {
  beforeEach(() => {
    motionTestState.controls.set.mockReset()
    motionTestState.controls.start.mockReset()
    motionTestState.controls.start.mockImplementation(() => Promise.resolve())
    motionTestState.controls.stop.mockReset()
    motionTestState.reducedMotion = true
  })

  afterEach(() => {
    restoreResizeObserver?.()
    restoreResizeObserver = null
    persistCacheMock.state.width = ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH
    persistCacheMock.state.byKey = {}
    persistCacheMock.state.windowByKey = {}
    persistCacheMock.setWidth.mockClear()
    persistCacheMock.setByKey.mockClear()
    persistCacheMock.setWindowByKey.mockClear()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  it('constrains the right pane to the chat shell height while preserving width', () => {
    const { container } = render(
      <RightPaneHost open width={460}>
        <div>artifact pane</div>
      </RightPaneHost>
    )

    const host = container.querySelector('[data-right-pane]')

    expect(host).toHaveClass('h-full', 'min-h-0', 'shrink-0', 'overflow-hidden')
    expect(host?.getAttribute('data-ui')?.split(/\s+/)).toContain('part:conversation-navigation')
  })

  it('disables pointer events on the pane content while resizing', () => {
    // A real mouse/document-level drag routes mousemove/mouseup to whatever DOM
    // element is under the cursor — an iframe (e.g. the HTML preview tab) swallows
    // those events instead of letting them bubble to this component's document
    // listeners. Shrinking the pane moves the cursor into space the content still
    // occupies before the resize catches up, so without this the drag looks stuck
    // as soon as the cursor crosses into an iframe. The content wrapper must carry
    // the pointer-events-none toggle (driven by the data-resizing group state) so
    // pointer events keep reaching the document-level listeners for the whole drag.
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    const contentWrapper = screen.getByText('artifact pane').parentElement

    expect(contentWrapper).toHaveClass('group-data-[resizing=true]/right-pane:pointer-events-none')
    expect(container.querySelector('[data-right-pane]')?.getAttribute('data-ui')?.split(/\s+/)).toContain(
      'part:conversation-inspector'
    )
  })

  it('does not render a resize handle by default', () => {
    const { container } = render(
      <PersistentRightPaneHost open width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    expect(container.querySelector('[data-right-pane-resize-handle]')).not.toBeInTheDocument()
  })

  it('uses the configured right pane default and minimum widths', () => {
    expect(ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH).toBe(280)
    expect(ARTIFACT_RIGHT_PANE_MIN_WIDTH).toBe(255)
    expect(DefaultRendererPersistCache['ui.chat.artifact_pane.width']).toBe(460)
    expect(ARTIFACT_RIGHT_PANE_MIN_WIDTH + CHAT_CENTER_MIN_USABLE_WIDTH).toBe(615)
  })

  it('lets the pane and the center share space instead of clamping the pane to zero', () => {
    const { container } = render(
      <PersistentRightPaneHost open width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    const spacer = container.querySelector('[data-right-pane-spacer]')

    // Yield order: pane first (stored → 255 while the center keeps 360), then the
    // center (360 → 200 with the pane pinned), then both proportionally — never 0.
    expect(motionTestState.controls.set).toHaveBeenCalledWith(
      expect.objectContaining({ width: 'max(min(460px, calc(100% - 360px)), min(255px, calc(100% * 255 / 455)))' })
    )
    // The spacer must share the exact expression or the pane would overlap the center.
    expect(spacer).toHaveStyle({ maxWidth: 'max(min(460px, calc(100% - 360px)), min(255px, calc(100% * 255 / 455)))' })
  })

  it('renders a left-edge resize handle when resizable', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')

    expect(handle).toBeInTheDocument()
    expect(handle).toHaveClass('left-0', 'cursor-col-resize')
  })

  it('reports a fixed reachable splitter range when both panes shrink proportionally', () => {
    mockMainRegionWidth(400)
    const { container } = render(
      <div data-main-region>
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')

    expect(handle).toHaveAttribute('aria-valuemin', '224')
    expect(handle).toHaveAttribute('aria-valuemax', '224')
    expect(handle).toHaveAttribute('aria-valuenow', '224')

    fireEvent.keyDown(handle as HTMLElement, { key: 'End' })
    fireEvent.keyDown(handle as HTMLElement, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle as HTMLElement, { key: 'ArrowRight' })

    expect(persistCacheMock.setWidth).not.toHaveBeenCalled()
  })

  it('persists a list pane under its own key and lets it reach the list floor', () => {
    mockMainRegionWidth(900)
    persistCacheMock.state.byKey[LIST_POLICY.cacheKey] = 275
    persistCacheMock.state.byKey[INSPECTOR_POLICY.cacheKey] = 460
    const { container } = render(
      <div data-main-region>
        <PersistentRightPaneHost
          open
          resizable
          minWidth={LIST_POLICY.minWidth}
          maxWidth={LIST_POLICY.maxWidth}
          cacheKey={LIST_POLICY.cacheKey}>
          <div>list pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')
    if (!handle) throw new Error('Expected resize handle')

    // The artifact pane's 255 floor must not leak in: the list reports (and reaches) its own 200.
    expect(handle).toHaveAttribute('aria-valuemin', String(LIST_POLICY.minWidth))
    expect(handle).toHaveAttribute('aria-valuemax', String(LIST_POLICY.maxWidth))

    fireEvent.keyDown(handle, { key: 'Home' })

    expect(persistCacheMock.setByKey).toHaveBeenCalledWith(LIST_POLICY.cacheKey, LIST_POLICY.minWidth)
    expect(persistCacheMock.state.byKey[INSPECTOR_POLICY.cacheKey]).toBe(460)
  })

  it.each([
    { policy: LIST_POLICY, windowKey: 'ui.window.chat.resource_pane.width' },
    { policy: INSPECTOR_POLICY, windowKey: 'ui.window.chat.artifact_pane.width' }
  ])('keeps detached $policy.cacheKey resizing local to its renderer window', ({ policy, windowKey }) => {
    mockMainRegionWidth(900)
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <div data-main-region>
          <PersistentRightPaneHost
            open
            resizable
            minWidth={policy.minWidth}
            maxWidth={policy.maxWidth}
            cacheKey={policy.cacheKey}>
            <div>pane</div>
          </PersistentRightPaneHost>
        </div>
      </WindowFrameProvider>
    )
    const handle = container.querySelector('[data-right-pane-resize-handle]')

    if (!handle) throw new Error('Expected resize handle')

    fireEvent.keyDown(handle, { key: 'Home' })

    expect(persistCacheMock.setWindowByKey).toHaveBeenCalledWith(windowKey, policy.minWidth)
    expect(persistCacheMock.setByKey).not.toHaveBeenCalled()
  })

  it('builds the list pane spacer expression from the list floor', () => {
    const { container } = render(
      <PersistentRightPaneHost
        open
        resizable
        width={275}
        minWidth={LIST_POLICY.minWidth}
        maxWidth={LIST_POLICY.maxWidth}
        cacheKey={LIST_POLICY.cacheKey}>
        <div>list pane</div>
      </PersistentRightPaneHost>
    )

    // The reserved space must yield to the list's own 200 floor; leaving the artifact's 255
    // here would let the pane paint wider than the space reserved for it and cover the center.
    expect(container.querySelector('[data-right-pane-spacer]')).toHaveStyle({
      maxWidth: 'max(min(280px, calc(100% - 360px)), min(200px, calc(100% * 200 / 400)))'
    })
  })

  it('pins a list pane at its own floor in a narrow main region', () => {
    mockMainRegionWidth(500)
    persistCacheMock.state.byKey[LIST_POLICY.cacheKey] = 275
    const { container } = render(
      <div data-main-region>
        <PersistentRightPaneHost
          open
          resizable
          minWidth={LIST_POLICY.minWidth}
          maxWidth={LIST_POLICY.maxWidth}
          cacheKey={LIST_POLICY.cacheKey}>
          <div>list pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')
    if (!handle) throw new Error('Expected resize handle')

    // 500 - 360 leaves less than the floor, so 200 is all the pane can show or reach.
    expect(handle).toHaveAttribute('aria-valuemax', '200')

    fireEvent.keyDown(handle, { key: 'Home' })
    fireEvent.keyDown(handle, { key: 'End' })

    expect(persistCacheMock.setByKey).not.toHaveBeenCalled()
  })

  it('limits the splitter maximum and End key to the currently reachable width', () => {
    mockMainRegionWidth(700)
    persistCacheMock.state.width = 280
    const { container } = render(
      <div data-main-region>
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')
    if (!handle) throw new Error('Expected resize handle')

    expect(handle).toHaveAttribute('aria-valuemin', '255')
    expect(handle).toHaveAttribute('aria-valuemax', '340')
    expect(handle).toHaveAttribute('aria-valuenow', '280')

    fireEvent.keyDown(handle, { key: 'End' })

    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(340)
  })

  it('keeps the resize handle above pane content overlays', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div className="absolute inset-0 z-20">preview overlay</div>
      </PersistentRightPaneHost>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')

    expect(handle).toBeInTheDocument()
    expect(handle).toHaveClass('z-30')
  })

  it('keeps one child instance across closed, docked, and maximized layouts', async () => {
    const lifecycle: string[] = []

    function StatefulPane() {
      const [count, setCount] = useState(0)

      useEffect(() => {
        lifecycle.push('mount')
        return () => {
          lifecycle.push('unmount')
        }
      }, [])

      return (
        <button type="button" onClick={() => setCount((current) => current + 1)}>
          pane state {count}
        </button>
      )
    }

    const { container, rerender } = render(
      <div className="relative">
        <PersistentRightPaneHost open width={460}>
          <StatefulPane />
        </PersistentRightPaneHost>
      </div>
    )
    const pane = screen.getByRole('button', { name: 'pane state 0' })
    fireEvent.click(pane)

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open={false} width={460}>
          <StatefulPane />
        </PersistentRightPaneHost>
      </div>
    )

    await waitFor(() => expect(container.querySelector('[data-right-pane]')).toHaveAttribute('inert'))
    // The fully closed pane is visibility:hidden, which strips accessible names —
    // query by text (visibility-agnostic) to assert the same instance survived.
    expect(screen.getByText('pane state 1', { selector: 'button' })).toBe(pane)

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open maximized width={460}>
          <StatefulPane />
        </PersistentRightPaneHost>
      </div>
    )

    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximized')
    )
    expect(screen.getByRole('button', { name: 'pane state 1' })).toBe(pane)
    expect(lifecycle).toEqual(['mount'])
  })

  it('exposes the covering composer height on the pane only while it spans full width', async () => {
    const { composerHost, mount, shell } = createShellRoot()
    const composer = createComposerSurface()
    composerHost.append(composer)
    stubRect(composer, { top: 700, bottom: 820 })

    const Harness = ({ maximized }: { maximized: boolean }) => (
      <div className="relative">
        <PersistentRightPaneHost open maximized={maximized} width={460}>
          <div>pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    const { container, rerender } = render(<Harness maximized={false} />, { container: mount })
    prepareMeasuredPane(container)

    const inset = () =>
      container.querySelector<HTMLElement>('[data-right-pane] > div')?.style.getPropertyValue('--chat-composer-inset')
    expect(inset()).toBe('')

    rerender(<Harness maximized />)
    // 800 - 700 of covered pane bottom, plus the gap the message list keeps.
    await waitFor(() => expect(inset()).toBe('116px'))

    rerender(<Harness maximized={false} />)
    await waitFor(() => expect(inset()).toBe(''))
    shell.remove()
  })

  it('re-observes the composer after a session switch replaces it', async () => {
    installTargetTrackingResizeObserver()
    const { composerHost, mount, shell } = createShellRoot()
    const composer = createComposerSurface()
    composerHost.append(composer)
    stubRect(composer, { top: 700, bottom: 820 })

    const Harness = ({ maximized }: { maximized: boolean }) => (
      <div className="relative">
        <PersistentRightPaneHost open maximized={maximized} width={460}>
          <div>pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    const { container, rerender } = render(<Harness maximized={false} />, { container: mount })
    prepareMeasuredPane(container)

    const inset = () =>
      container.querySelector<HTMLElement>('[data-right-pane] > div')?.style.getPropertyValue('--chat-composer-inset')
    rerender(<Harness maximized />)
    await waitFor(() => expect(inset()).toBe('116px'))

    // The session key remounts the composer under a pane that stays maximized. The old node
    // leaves the document, where it measures as a zero rect.
    composer.remove()
    stubRect(composer, { top: 0, bottom: 0 })
    const replacement = createComposerSurface()
    composerHost.append(replacement)
    stubRect(replacement, { top: 600, bottom: 820 })
    act(() => resizeTarget(composer))
    await waitFor(() => expect(inset()).toBe('216px'))

    // Only reaches the hook if the replacement is now observed in the old node's place.
    stubRect(replacement, { top: 500, bottom: 820 })
    act(() => resizeTarget(replacement))
    await waitFor(() => expect(inset()).toBe('316px'))
    shell.remove()
  })

  it('picks up a composer that mounts after the pane is already maximized', async () => {
    installTargetTrackingResizeObserver()
    const { composerHost, mount, shell } = createShellRoot()

    const Harness = ({ maximized }: { maximized: boolean }) => (
      <div className="relative">
        <PersistentRightPaneHost open maximized={maximized} width={460}>
          <div>pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    const { container, rerender } = render(<Harness maximized={false} />, { container: mount })
    prepareMeasuredPane(container)

    const inset = () =>
      container.querySelector<HTMLElement>('[data-right-pane] > div')?.style.getPropertyValue('--chat-composer-inset')
    rerender(<Harness maximized />)
    await waitFor(() => expect(inset()).toBe(''))

    // An empty center carries no composer; selecting a topic mounts one while the pane stays
    // maximized. A DOM insertion resizes nothing, so only a mutation watch can notice it.
    const composer = createComposerSurface()
    stubRect(composer, { top: 640, bottom: 820 })
    composerHost.append(composer)

    await waitFor(() => expect(inset()).toBe('176px'))
    shell.remove()
  })

  it('hands Motion the box width rather than wiping a clip across a fixed box', async () => {
    const dockedWidth = 'max(min(460px, calc(100% - 360px)), min(255px, calc(100% * 255 / 455)))'
    const Harness = ({ maximized }: { maximized: boolean }) => (
      <div className="relative">
        <PersistentRightPaneHost open maximized={maximized} width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    const { container, rerender } = render(<Harness maximized={false} />)
    const pane = () => container.querySelector<HTMLElement>('[data-right-pane]')
    motionTestState.controls.set.mockClear()
    motionTestState.controls.start.mockClear()

    rerender(<Harness maximized />)
    await waitFor(() => expect(pane()).toHaveAttribute('data-right-pane-phase', 'maximized'))

    expect(motionTestState.controls.start).toHaveBeenCalledWith(expect.objectContaining({ width: '100%' }))
    // The old mechanism cropped a full-width box back to the docked strip; nothing may reinstate
    // it, or the pane content would again lay out for full width behind that strip.
    expect(motionTestState.controls.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ clipPath: expect.stringContaining('calc(100% -') })
    )

    motionTestState.controls.start.mockClear()
    rerender(<Harness maximized={false} />)
    await waitFor(() => expect(pane()).toHaveAttribute('data-right-pane-phase', 'docked'))

    // The space-clamped expression, not the raw stored width: the box has to animate to the
    // width it will actually occupy once docked.
    expect(motionTestState.controls.start).toHaveBeenCalledWith(expect.objectContaining({ width: dockedWidth }))
  })

  it('restores the settled maximized visual state when Activity reconnects effects', () => {
    const onLayoutAnimationComplete = vi.fn()
    const { rerender } = render(
      <ActivityRightPaneHarness visible maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />
    )
    motionTestState.controls.set.mockClear()
    motionTestState.controls.start.mockClear()

    rerender(
      <ActivityRightPaneHarness visible={false} maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />
    )
    motionTestState.controls.set.mockClear()
    motionTestState.controls.start.mockClear()

    rerender(<ActivityRightPaneHarness visible maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />)

    expect(motionTestState.controls.set).toHaveBeenCalledTimes(1)
    expect(motionTestState.controls.set).toHaveBeenCalledWith({
      clipPath: 'inset(0% 0% 0% 0%)',
      opacity: 1,
      width: '100%'
    })
    expect(motionTestState.controls.start).not.toHaveBeenCalled()
    expect(onLayoutAnimationComplete).not.toHaveBeenCalled()
  })

  it('settles an interrupted maximize when Activity reconnects effects', async () => {
    const onLayoutAnimationComplete = vi.fn()

    const { container, rerender } = render(
      <ActivityRightPaneHarness visible onLayoutAnimationComplete={onLayoutAnimationComplete} />
    )
    rerender(<ActivityRightPaneHarness visible maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />)

    expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximizing')

    rerender(
      <ActivityRightPaneHarness visible={false} maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />
    )
    motionTestState.controls.set.mockClear()
    rerender(<ActivityRightPaneHarness visible maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />)

    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximized')
    )
    expect(motionTestState.controls.set).toHaveBeenCalledWith({
      clipPath: 'inset(0% 0% 0% 0%)',
      opacity: 1,
      width: '100%'
    })
    expect(onLayoutAnimationComplete).toHaveBeenCalledTimes(1)
    expect(onLayoutAnimationComplete).toHaveBeenCalledWith('maximized')

    // A settle left over from the interrupted phase would report a second completion here.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onLayoutAnimationComplete).toHaveBeenCalledTimes(1)
  })

  it('settles an interrupted minimize when Activity reconnects effects', async () => {
    const onLayoutAnimationComplete = vi.fn()

    const { container, rerender } = render(
      <ActivityRightPaneHarness visible maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />
    )
    rerender(<ActivityRightPaneHarness visible onLayoutAnimationComplete={onLayoutAnimationComplete} />)

    expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'minimizing')

    rerender(<ActivityRightPaneHarness visible={false} onLayoutAnimationComplete={onLayoutAnimationComplete} />)
    motionTestState.controls.set.mockClear()
    rerender(<ActivityRightPaneHarness visible onLayoutAnimationComplete={onLayoutAnimationComplete} />)

    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'docked')
    )
    expect(motionTestState.controls.set).toHaveBeenCalledWith({
      clipPath: 'inset(0% 0% 0% 0%)',
      opacity: 1,
      width: 'max(min(460px, calc(100% - 360px)), min(255px, calc(100% * 255 / 455)))'
    })
    expect(onLayoutAnimationComplete).toHaveBeenCalledTimes(1)
    expect(onLayoutAnimationComplete).toHaveBeenCalledWith('docked')

    // A settle left over from the interrupted phase would report a second completion here.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onLayoutAnimationComplete).toHaveBeenCalledTimes(1)
  })

  it('settles to a target that changed while Activity effects were disconnected', async () => {
    const onLayoutAnimationComplete = vi.fn()
    const { container, rerender } = render(
      <ActivityRightPaneHarness visible onLayoutAnimationComplete={onLayoutAnimationComplete} />
    )

    rerender(<ActivityRightPaneHarness visible={false} onLayoutAnimationComplete={onLayoutAnimationComplete} />)
    motionTestState.controls.set.mockClear()
    motionTestState.controls.start.mockClear()

    rerender(
      <ActivityRightPaneHarness visible={false} maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />
    )
    rerender(<ActivityRightPaneHarness visible maximized onLayoutAnimationComplete={onLayoutAnimationComplete} />)

    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximized')
    )
    expect(motionTestState.controls.set).toHaveBeenCalledWith({
      clipPath: 'inset(0% 0% 0% 0%)',
      opacity: 1,
      width: '100%'
    })
    expect(motionTestState.controls.start).not.toHaveBeenCalled()
    expect(onLayoutAnimationComplete).toHaveBeenCalledTimes(1)
    expect(onLayoutAnimationComplete).toHaveBeenCalledWith('maximized')
  })

  it('ignores a stale maximize completion when minimizing before it finishes', async () => {
    const onLayoutAnimationComplete = vi.fn()

    const { container, rerender } = render(
      <div className="relative">
        <PersistentRightPaneHost open width={460} onLayoutAnimationComplete={onLayoutAnimationComplete}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open maximized width={460} onLayoutAnimationComplete={onLayoutAnimationComplete}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximizing')

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open width={460} onLayoutAnimationComplete={onLayoutAnimationComplete}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    expect(motionTestState.controls.stop).toHaveBeenCalled()
    expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'minimizing')

    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'docked')
    )
    expect(onLayoutAnimationComplete).toHaveBeenCalledTimes(1)
    expect(onLayoutAnimationComplete).toHaveBeenCalledWith('docked')
  })

  it('commits the final drag width once on mouse up and cleans document resize styles', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )
    const pane = container.querySelector('[data-right-pane]')
    const handle = container.querySelector('[data-right-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected right pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

    fireEvent.mouseDown(handle, { clientX: 340 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')

    fireEvent.mouseMove(document, { clientX: 300 })
    fireEvent.mouseMove(document, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 20 })

    // No commits to the persisted cache while the drag is in progress — the
    // rAF-batched live width never touches usePersistCache.
    expect(persistCacheMock.setWidth).not.toHaveBeenCalled()

    fireEvent.mouseUp(document)

    // Exactly one commit, with the last mousemove's clamped width (800 - 20 = 780,
    // clamped down to the max).
    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(ARTIFACT_RIGHT_PANE_MAX_WIDTH)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')
  })

  it('closes the pane instead of committing when the drag travels well past the minimum width', () => {
    const onDragClose = vi.fn()
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460} onDragClose={onDragClose}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )
    const pane = container.querySelector('[data-right-pane]')
    const handle = container.querySelector('[data-right-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected right pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

    fireEvent.mouseDown(handle, { clientX: 340 })
    // Just under the minimum width is a clamp, not a close.
    fireEvent.mouseMove(document, { clientX: 560 })
    expect(onDragClose).not.toHaveBeenCalled()
    // Overshooting the minimum-width line by more than 80px closes: 800 - 630 = 170 < 255 - 80.
    fireEvent.mouseMove(document, { clientX: 630 })

    expect(onDragClose).toHaveBeenCalledTimes(1)
    expect(persistCacheMock.setWidth).not.toHaveBeenCalled()
    expect(pane).not.toHaveAttribute('data-resizing')
    expect(document.body.style.cursor).toBe('')
  })

  it('does not commit to the persisted cache before window blur ends the drag', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )
    const pane = container.querySelector('[data-right-pane]')
    const handle = container.querySelector('[data-right-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected right pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

    fireEvent.mouseDown(handle, { clientX: 340 })
    fireEvent.mouseMove(document, { clientX: 300 })
    expect(pane).toHaveAttribute('data-resizing', 'true')
    expect(document.body.style.cursor).toBe('col-resize')
    expect(persistCacheMock.setWidth).not.toHaveBeenCalled()

    fireEvent.blur(window)

    // Blur ends the drag, committing the last pending width once (800 - 300 = 500).
    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(500)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')

    fireEvent.mouseMove(document, { clientX: 20 })

    // The drag already ended — a later mousemove must not commit again.
    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
  })

  describe('rAF-batched drag width', () => {
    let rafCallbacks: FrameRequestCallback[]
    let nextRafId: number
    const originalRaf = window.requestAnimationFrame
    const originalCancelRaf = window.cancelAnimationFrame

    beforeEach(() => {
      rafCallbacks = []
      nextRafId = 1
      window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback)
        return nextRafId++
      }) as typeof window.requestAnimationFrame
      window.cancelAnimationFrame = vi.fn()
    })

    afterEach(() => {
      window.requestAnimationFrame = originalRaf
      window.cancelAnimationFrame = originalCancelRaf
    })

    function flushRaf() {
      const callbacks = rafCallbacks
      rafCallbacks = []
      act(() => {
        callbacks.forEach((callback) => callback(0))
      })
    }

    it('schedules at most one rAF-driven width update per animation frame', () => {
      const { container } = render(
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      )
      const pane = container.querySelector('[data-right-pane]')
      const handle = container.querySelector('[data-right-pane-resize-handle]')

      if (!pane || !handle) {
        throw new Error('Expected right pane and resize handle')
      }

      vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

      fireEvent.mouseDown(handle, { clientX: 340 })

      fireEvent.mouseMove(document, { clientX: 300 })
      fireEvent.mouseMove(document, { clientX: 320 })
      fireEvent.mouseMove(document, { clientX: 310 })

      // Three mousemoves within the same (un-flushed) frame only schedule once.
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)

      flushRaf()

      fireEvent.mouseMove(document, { clientX: 305 })

      // The previous flush cleared the "scheduled" flag, so a new move schedules again.
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2)

      fireEvent.mouseUp(document)
    })

    it('commits immediately via the keyboard/a11y path, bypassing rAF', () => {
      const { container } = render(
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      )
      const handle = container.querySelector('[data-right-pane-resize-handle]')

      if (!handle) {
        throw new Error('Expected resize handle')
      }

      fireEvent.keyDown(handle, { key: 'Home' })

      expect(window.requestAnimationFrame).not.toHaveBeenCalled()
      expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
      expect(persistCacheMock.setWidth).toHaveBeenCalledWith(ARTIFACT_RIGHT_PANE_MIN_WIDTH)
    })

    it('cancels a pending rAF and does not update state after unmount', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { container, unmount } = render(
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      )
      const pane = container.querySelector('[data-right-pane]')
      const handle = container.querySelector('[data-right-pane-resize-handle]')

      if (!pane || !handle) {
        throw new Error('Expected right pane and resize handle')
      }

      vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

      fireEvent.mouseDown(handle, { clientX: 340 })
      fireEvent.mouseMove(document, { clientX: 300 })

      expect(rafCallbacks).toHaveLength(1)

      unmount()

      // Drag end (fired by useResizeDrag's own unmount cleanup) cancels the pending rAF.
      expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1)

      // Flushing the rAF callback captured before unmount must not throw or
      // trigger a React "state update on an unmounted component" warning.
      expect(() => flushRaf()).not.toThrow()
      expect(consoleError).not.toHaveBeenCalled()

      consoleError.mockRestore()
    })
  })
})
