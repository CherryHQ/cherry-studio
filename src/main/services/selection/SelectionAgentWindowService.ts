import { randomUUID } from 'node:crypto'

import type { BrowserWindow, Rectangle } from 'electron'
import { screen } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isMac } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import type { AgentSelectionAction, SelectionActionSession, SelectionAgentWindowLayout } from '@shared/types/selection'

import { placeSelectionAgentWindow, resizeSelectionAgentWindow } from './selectionAgentWindowBounds'

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
 * Owns selection agent windows: opening one per agent action, and sizing it as it moves
 * from the compose bar to the conversation window.
 */
@Injectable('SelectionAgentWindowService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class SelectionAgentWindowService extends BaseService {
  private readonly layouts = new Map<string, LayoutMode>()
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
    this.registerDisposable(wm.onWindowDestroyedByType(WindowType.SelectionAgent, ({ id }) => this.layouts.delete(id)))
  }

  /** Built-in `ask-agent` opens the compose bar; an agent-bound custom action opens straight into the conversation. */
  open(action: AgentSelectionAction, { anchor, isFullScreen }: SelectionAgentWindowPlacement): void {
    const wm = application.get('WindowManager')
    const mode: LayoutMode = action.isBuiltIn ? 'compose' : 'conversation'
    const size = mode === 'compose' ? { width: COMPOSE_WIDTH, height: COMPOSE_INITIAL_HEIGHT } : CONVERSATION_SIZE

    const windowId = wm.open(WindowType.SelectionAgent, {
      initData: { ...action, sessionId: randomUUID() } satisfies SelectionActionSession
    })
    const window = wm.getWindow(windowId)
    if (!window) {
      logger.error(`Failed to get selection agent window ${windowId}`)
      return
    }

    this.layouts.set(windowId, mode)
    this.applySizeLimits(window, mode)
    const display = anchor
      ? screen.getDisplayMatching(anchor)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    window.setBounds(placeSelectionAgentWindow(size, anchor, display.workArea))
    this.show(window, isFullScreen)
    // Without this, the IME candidate panel stays out of the full-screen Space and never appears.
    if (isMac && isFullScreen) wm.behavior.hideMacDockWhileShown(windowId)
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
