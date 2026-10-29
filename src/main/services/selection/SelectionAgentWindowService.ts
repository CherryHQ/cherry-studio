import { randomUUID } from 'node:crypto'

import type { BrowserWindow, Rectangle, Size } from 'electron'
import { screen } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isMac } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import type {
  AgentSelectionAction,
  SelectionActionSession,
  SelectionAgentSummary,
  SelectionAgentWindowLayout
} from '@shared/types/selection'

import { placeSelectionAgentWindow, resizeSelectionAgentWindow } from './selectionAgentWindowBounds'
import {
  type CollapsedSelectionAgent,
  orderSelectionAgentCapsules,
  placeSelectionCapsuleHost
} from './selectionCapsuleLayout'

const logger = loggerService.withContext('SelectionAgentWindowService')

const COMPOSE_WIDTH = 560
/** Placeholder until the renderer reports the compose bar's measured height. */
const COMPOSE_INITIAL_HEIGHT = 160
const CONVERSATION_SIZE = { width: 560, height: 620 }
const CONVERSATION_MIN_SIZE = { width: 420, height: 480 }

type LayoutMode = SelectionAgentWindowLayout['mode']

export interface SelectionAgentWindowPlacement {
  /** Toolbar bounds to open under, or null to center on the cursor's display. */
  anchor: Rectangle | null
  /** [macOS] Whether the selection came from a full-screen app. */
  isFullScreen: boolean
}

/**
 * Owns selection agent windows: opening one per agent action, sizing it as it moves from the
 * compose bar to the conversation window, replacing windows that hold nothing to lose, and
 * collapsing started windows into capsules stacked at the bottom-right of their display.
 */
@Injectable('SelectionAgentWindowService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class SelectionAgentWindowService extends BaseService {
  private readonly layouts = new Map<string, LayoutMode>()
  /** Windows whose renderer reports nothing to lose, so the next trigger closes them. */
  private readonly replaceable = new Set<string>()
  /** What each window's capsule would show, as its renderer last reported. */
  private readonly summaries = new Map<string, SelectionAgentSummary>()
  private readonly collapsed = new Map<string, { displayId: number; collapsedAt: number }>()
  /** One capsule host window per display that has capsules. */
  private readonly capsuleHosts = new Map<number, string>()
  /** Each host's last measured size in window pixels, to re-anchor it when its display changes. */
  private readonly capsuleHostSizes = new Map<string, Size>()
  private nativePanel?: {
    configurePanel(handle: Buffer): void
    moveToActiveSpace(handle: Buffer): void
  }

  private getNativePanel(): NonNullable<SelectionAgentWindowService['nativePanel']> {
    return (this.nativePanel ??= require(application.getPath('feature.selection.native_panel_file')))
  }

  protected onInit(): void {
    const wm = application.get('WindowManager')
    this.registerDisposable(
      wm.onWindowCreatedByType(WindowType.SelectionAgent, ({ window }) => {
        if (isMac) this.getNativePanel().configurePanel(window.getNativeWindowHandle())
      })
    )
    this.registerDisposable(
      wm.onWindowDestroyedByType(WindowType.SelectionAgent, ({ id }) => {
        this.layouts.delete(id)
        this.replaceable.delete(id)
        this.summaries.delete(id)
        if (this.collapsed.delete(id)) this.syncCapsules()
      })
    )
    this.registerDisposable(
      wm.onWindowDestroyedByType(WindowType.SelectionCapsule, ({ id }) => {
        this.capsuleHostSizes.delete(id)
        for (const [displayId, hostId] of this.capsuleHosts) {
          if (hostId === id) this.capsuleHosts.delete(displayId)
        }
      })
    )

    const onDisplayChange = () => this.syncCapsules()
    screen.on('display-removed', onDisplayChange)
    screen.on('display-metrics-changed', onDisplayChange)
    this.registerDisposable(() => {
      screen.removeListener('display-removed', onDisplayChange)
      screen.removeListener('display-metrics-changed', onDisplayChange)
    })
  }

  /** Built-in `ask-agent` opens the compose bar; an agent-bound custom action opens straight into the conversation. */
  open(action: AgentSelectionAction, { anchor, isFullScreen }: SelectionAgentWindowPlacement): void {
    const wm = application.get('WindowManager')
    const mode: LayoutMode = action.isBuiltIn ? 'compose' : 'conversation'
    const size = mode === 'compose' ? { width: COMPOSE_WIDTH, height: COMPOSE_INITIAL_HEIGHT } : CONVERSATION_SIZE

    for (const id of this.replaceable) {
      // A collapsed window keeps its report for when it is restored.
      if (this.collapsed.has(id)) continue
      // A hidden one already went back to the pool.
      if (wm.getWindow(id)?.isVisible()) wm.close(id)
      this.replaceable.delete(id)
    }

    const windowId = wm.open(WindowType.SelectionAgent, {
      initData: { ...action, sessionId: randomUUID() } satisfies SelectionActionSession
    })
    const window = wm.getWindow(windowId)
    if (!window) {
      logger.error(`Failed to get selection agent window ${windowId}`)
      return
    }

    this.layouts.set(windowId, mode)
    this.summaries.delete(windowId)
    this.applySizeLimits(window, mode)
    const display = anchor
      ? screen.getDisplayMatching(anchor)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    window.setBounds(placeSelectionAgentWindow(size, anchor, display.workArea))
    this.show(window, isFullScreen)
    // Without this, the IME candidate panel stays out of the full-screen Space and never appears.
    if (isMac && isFullScreen) wm.behavior.hideMacDockWhileShown(windowId)
  }

  setReplaceable(windowId: string, replaceable: boolean): void {
    if (!this.layouts.has(windowId)) return
    if (replaceable) this.replaceable.add(windowId)
    else this.replaceable.delete(windowId)
  }

  /** Records what the window's capsule shows, and refreshes the capsule while it is collapsed. */
  setSummary(windowId: string, summary: SelectionAgentSummary): void {
    if (!this.layouts.has(windowId)) return
    this.summaries.set(windowId, summary)
    if (this.collapsed.has(windowId)) this.syncCapsules()
  }

  /** Hides a started window into a capsule; the compose bar cannot collapse, nor a window with nothing to show yet. */
  collapse(windowId: string): void {
    if (this.layouts.get(windowId) !== 'conversation' || this.collapsed.has(windowId)) return
    if (!this.summaries.has(windowId)) return
    const wm = application.get('WindowManager')
    const window = wm.getWindow(windowId)
    if (!window || window.isDestroyed() || !window.isVisible()) return

    const display = screen.getDisplayMatching(window.getBounds())
    this.collapsed.set(windowId, { displayId: display.id, collapsedAt: Date.now() })
    wm.hide(windowId)
    this.syncCapsules()
  }

  /** Closes or collapses a window that lost focus, unless it already went into a capsule. */
  dismissBlurred(windowId: string, dismissal: 'close' | 'collapse'): void {
    if (this.collapsed.has(windowId)) return
    if (dismissal === 'collapse') this.collapse(windowId)
    else application.get('WindowManager').close(windowId)
  }

  /** Shows a collapsed window again where it was; only the capsule host showing it may ask. */
  restore(hostId: string, windowId: string): void {
    if (!this.isShownBy(hostId, windowId)) return
    this.collapsed.delete(windowId)
    const window = application.get('WindowManager').getWindow(windowId)
    if (window && !window.isDestroyed()) this.show(window, false)
    this.syncCapsules()
  }

  /** Closes a collapsed window from its capsule. Its turn keeps running; only Stop aborts it. */
  closeCollapsed(hostId: string, windowId: string): void {
    if (!this.isShownBy(hostId, windowId)) return
    this.collapsed.delete(windowId)
    application.get('WindowManager').close(windowId)
    this.syncCapsules()
  }

  /** Anchors a capsule host at the size its renderer measured, showing it on the first measurement. */
  fitCapsuleHost(hostId: string, size: Size): void {
    const window = application.get('WindowManager').getWindow(hostId)
    if (!window || window.isDestroyed() || size.width <= 0 || size.height <= 0) return
    if (![...this.capsuleHosts.values()].includes(hostId)) return
    const zoom = window.webContents.getZoomFactor()
    this.capsuleHostSizes.set(hostId, {
      width: Math.ceil(size.width * zoom),
      height: Math.ceil(size.height * zoom)
    })
    this.placeCapsuleHosts()
    if (!window.isVisible()) this.showCapsuleHost(window)
  }

  /** Fits the compose bar to its content, or expands it once into the conversation window. */
  resize(windowId: string, layout: SelectionAgentWindowLayout): void {
    if (this.layouts.get(windowId) !== 'compose') return
    const window = application.get('WindowManager').getWindow(windowId)
    if (!window || window.isDestroyed()) return

    const bounds = window.getBounds()
    // The renderer measures CSS pixels, which the page zoom scales into window pixels.
    const size =
      layout.mode === 'compose'
        ? { width: bounds.width, height: Math.ceil(layout.height * window.webContents.getZoomFactor()) }
        : CONVERSATION_SIZE
    this.layouts.set(windowId, layout.mode)
    this.applySizeLimits(window, layout.mode)
    window.setBounds(resizeSelectionAgentWindow(bounds, size, screen.getDisplayMatching(bounds).workArea))
  }

  private applySizeLimits(window: BrowserWindow, mode: LayoutMode): void {
    const resizable = mode === 'conversation'
    window.setResizable(resizable)
    window.setMinimumSize(resizable ? CONVERSATION_MIN_SIZE.width : 0, resizable ? CONVERSATION_MIN_SIZE.height : 0)
  }

  private isShownBy(hostId: string, windowId: string): boolean {
    const entry = this.collapsed.get(windowId)
    return entry !== undefined && this.capsuleHosts.get(this.resolveDisplay(entry.displayId).id) === hostId
  }

  /** A capsule whose display was removed moves to the primary display. */
  private resolveDisplay(displayId: number): Electron.Display {
    return screen.getAllDisplays().find((display) => display.id === displayId) ?? screen.getPrimaryDisplay()
  }

  /** Publishes each display's ordered stack, opening a host for a new stack and closing the host of an empty one. */
  private syncCapsules(): void {
    const wm = application.get('WindowManager')
    const stacks = new Map<number, CollapsedSelectionAgent[]>()
    for (const [windowId, { displayId, collapsedAt }] of this.collapsed) {
      const summary = this.summaries.get(windowId)
      if (!summary) continue
      const id = this.resolveDisplay(displayId).id
      stacks.set(id, [...(stacks.get(id) ?? []), { capsule: { ...summary, windowId }, collapsedAt }])
    }

    for (const displayId of new Set([...stacks.keys(), ...this.capsuleHosts.keys()])) {
      const stack = stacks.get(displayId)
      application
        .get('CacheService')
        .setShared(`selection.agent_capsules.${displayId}`, stack ? orderSelectionAgentCapsules(stack) : [])
      const hostId = this.capsuleHosts.get(displayId)
      if (stack && !hostId) {
        this.capsuleHosts.set(displayId, wm.open(WindowType.SelectionCapsule, { initData: { displayId } }))
      } else if (!stack && hostId) {
        this.capsuleHosts.delete(displayId)
        this.capsuleHostSizes.delete(hostId)
        wm.close(hostId)
      }
    }
    this.placeCapsuleHosts()
  }

  private placeCapsuleHosts(): void {
    const wm = application.get('WindowManager')
    for (const [displayId, hostId] of this.capsuleHosts) {
      const size = this.capsuleHostSizes.get(hostId)
      const window = wm.getWindow(hostId)
      if (size && window && !window.isDestroyed()) {
        window.setBounds(placeSelectionCapsuleHost(size, this.resolveDisplay(displayId).workArea))
      }
    }
  }

  // Shown inactive like the toolbar, so a click on a capsule never takes focus from the app in front.
  private showCapsuleHost(window: BrowserWindow): void {
    // [macOS] Focusable panels pull the app's other windows forward when shown.
    if (isMac) window.setFocusable(false)
    window.showInactive()
  }

  // Same show sequence as SelectionService.showActionWindow: a recycled panel may still belong
  // to another Space, and over a full-screen app it must appear inactive before taking focus.
  private show(window: BrowserWindow, isFullScreen: boolean): void {
    if (!isMac) {
      window.show()
      return
    }

    if (!isFullScreen) {
      this.getNativePanel().moveToActiveSpace(window.getNativeWindowHandle())
      window.show()
      return
    }

    window.setFocusable(false)
    window.setAlwaysOnTop(true)
    this.getNativePanel().moveToActiveSpace(window.getNativeWindowHandle())
    window.showInactive()

    setTimeout(() => {
      if (window.isDestroyed()) return
      window.setAlwaysOnTop(false)
      window.setFocusable(true)
      window.focus()
    }, 50)
  }
}
