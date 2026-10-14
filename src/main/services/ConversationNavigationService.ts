import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import { getFullChromeWindowInfos } from '@main/utils/fullChromeWindows'
import type { WindowId } from '@shared/ipc/types'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import { conversationRouteUrl } from '@shared/utils/conversationRoute'

import { openRouteInMainWindow } from './mainWindowNavigation'

const OWNERSHIP_RESPONSE_TIMEOUT_MS = 200
const OWNERSHIP_RETRY_DELAY_MS = 50
const NAVIGATION_DISCOVERY_TIMEOUT_MS = 10_000
const NAVIGATION_COMMAND_TIMEOUT_MS = 5_000

interface PendingOwnershipQuery {
  expectedWindowIds: Set<WindowId>
  ownerWindowIds: Set<WindowId>
  respondingWindowIds: Set<WindowId>
  resolve: (snapshot: OwnershipSnapshot | null) => void
  timer: ReturnType<typeof setTimeout>
}

interface OwnershipSnapshot {
  ownerWindowIds: WindowId[]
  respondingWindowIds: WindowId[]
}

interface PendingNavigationCommand {
  destinationWindowId: WindowId
  resolve: (completed: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

function conversationTargetKey(target: ConversationNavigationTarget): string {
  return `${target.conversationType}:${target.conversationId}`
}

function compareWindowPriority(left: WindowInfo, right: WindowInfo): number {
  if (left.isFocused !== right.isFocused) return left.isFocused ? -1 : 1
  if (left.isVisible !== right.isVisible) return left.isVisible ? -1 : 1
  if (left.type !== right.type) return left.type === WindowType.Main ? -1 : 1
  return left.createdAt - right.createdAt
}

/**
 * Main-owned coordinator for cross-window conversation navigation.
 *
 * Tabs stay renderer-owned. Instead of mirroring them into main, each focus-or-open operation asks
 * every full-chrome TabsProvider for its current ownership snapshot, waits for a complete snapshot,
 * then chooses exactly one destination. The destination confirms after its tab state commits;
 * concurrent requests for the same conversation share that whole operation, so notification clicks
 * cannot open duplicate tabs across windows.
 */
@Injectable('ConversationNavigationService')
@DependsOn(['WindowManager', 'MainWindowService'])
@ServicePhase(Phase.WhenReady)
export class ConversationNavigationService extends BaseService {
  private readonly pendingQueries = new Map<string, PendingOwnershipQuery>()
  private readonly pendingCommands = new Map<string, PendingNavigationCommand>()
  private readonly inFlightTargets = new Map<string, Promise<void>>()
  private nextRequestId = 0
  private isStopping = false

  protected onInit(): void {
    this.isStopping = false
  }

  public focusOrOpen(
    target: ConversationNavigationTarget,
    title: string,
    requestingWindowId: WindowId | null = null
  ): Promise<void> {
    if (this.isStopping) return Promise.resolve()

    const targetKey = conversationTargetKey(target)
    const existing = this.inFlightTargets.get(targetKey)
    if (existing) return existing

    const operation = this.focusOrOpenDirect(target, title, requestingWindowId).finally(() => {
      if (this.inFlightTargets.get(targetKey) === operation) this.inFlightTargets.delete(targetKey)
    })
    this.inFlightTargets.set(targetKey, operation)
    return operation
  }

  public reportOwnership(requestId: string, windowId: WindowId, ownsTarget: boolean): void {
    const pending = this.pendingQueries.get(requestId)
    if (pending?.expectedWindowIds.delete(windowId)) {
      pending.respondingWindowIds.add(windowId)
      if (ownsTarget) pending.ownerWindowIds.add(windowId)
      if (pending.expectedWindowIds.size === 0) this.settleOwnershipQuery(requestId)
      return
    }

    const command = this.pendingCommands.get(requestId)
    if (command?.destinationWindowId === windowId) this.settleNavigationCommand(requestId, ownsTarget)
  }

  protected onStop(): void {
    this.isStopping = true
    this.cancelOwnershipQueries()
    this.cancelNavigationCommands()
  }

  protected onDestroy(): void {
    this.isStopping = true
    this.cancelOwnershipQueries()
    this.cancelNavigationCommands()
  }

  private async focusOrOpenDirect(
    target: ConversationNavigationTarget,
    title: string,
    requestingWindowId: WindowId | null
  ): Promise<void> {
    const discoveryDeadline = Date.now() + NAVIGATION_DISCOVERY_TIMEOUT_MS
    let coldRouteOpened = false

    while (!this.isStopping) {
      const windows = getFullChromeWindowInfos()
      if (windows.length === 0) {
        if (!coldRouteOpened) {
          openRouteInMainWindow(conversationRouteUrl(target))
          coldRouteOpened = true
        }
        await this.waitBeforeOwnershipRetry(discoveryDeadline, target)
        continue
      }

      const query = await this.queryOwners(windows, target)
      if (!query || this.isStopping) return

      const liveWindows = getFullChromeWindowInfos()
      const windowById = new Map(liveWindows.map((window) => [window.id, window]))
      const respondingWindowIds = new Set(query.respondingWindowIds)

      // A timeout is an unknown ownership state, not a negative response. Retry until every
      // currently-live full-chrome renderer answers (or disappears) so a busy owner can never be
      // mistaken for an absent one and duplicated in another window.
      if (liveWindows.some((window) => !respondingWindowIds.has(window.id))) {
        await this.waitBeforeOwnershipRetry(discoveryDeadline, target)
        continue
      }

      const owners = query.ownerWindowIds
        .map((windowId) => windowById.get(windowId))
        .filter((window): window is WindowInfo => window !== undefined)
        .sort(compareWindowPriority)

      // `openRouteInMainWindow` used durable init data because no Main window existed. Wait until
      // that new Main renderer reports the target as committed; sending another force-open command
      // while its init-data route is still mounting could create a duplicate.
      if (coldRouteOpened) {
        const mainOwner = owners.find((window) => window.type === WindowType.Main)
        if (mainOwner) {
          this.focusWindow(mainOwner)
          return
        }
        await this.waitBeforeOwnershipRetry(discoveryDeadline, target)
        continue
      }

      const owner = owners[0]
      const requester =
        requestingWindowId && respondingWindowIds.has(requestingWindowId)
          ? windowById.get(requestingWindowId)
          : undefined
      const respondingMainWindow = liveWindows
        .filter((window) => window.type === WindowType.Main && respondingWindowIds.has(window.id))
        .sort(compareWindowPriority)[0]
      const destination = owner ?? requester ?? respondingMainWindow

      if (!destination) {
        openRouteInMainWindow(conversationRouteUrl(target))
        coldRouteOpened = true
        await this.waitBeforeOwnershipRetry(discoveryDeadline, target)
        continue
      }

      const completed = await this.sendFocusOrOpenCommand(destination, query.requestId, target, title)
      if (!completed && !this.isStopping) {
        throw new Error(`Conversation navigation was not completed: ${conversationTargetKey(target)}`)
      }
      return
    }
  }

  private sendFocusOrOpenCommand(
    destination: WindowInfo,
    requestId: string,
    target: ConversationNavigationTarget,
    title: string
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settleNavigationCommand(requestId, false), NAVIGATION_COMMAND_TIMEOUT_MS)
      timer.unref()
      this.pendingCommands.set(requestId, { destinationWindowId: destination.id, resolve, timer })

      application.get('IpcApiService').send(destination.id, 'navigation.conversation_focus_or_open_requested', {
        requestId,
        target,
        title
      })
      this.focusWindow(destination)
    })
  }

  private async waitBeforeOwnershipRetry(
    discoveryDeadline: number,
    target: ConversationNavigationTarget
  ): Promise<void> {
    const remainingMs = discoveryDeadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for conversation owners: ${conversationTargetKey(target)}`)
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(OWNERSHIP_RETRY_DELAY_MS, remainingMs))
      timer.unref()
    })
  }

  private queryOwners(
    windows: WindowInfo[],
    target: ConversationNavigationTarget
  ): Promise<({ requestId: string } & OwnershipSnapshot) | null> {
    const requestId = `conversation-navigation:${this.nextRequestId++}`
    if (windows.length === 0) {
      return Promise.resolve({ requestId, ownerWindowIds: [], respondingWindowIds: [] })
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settleOwnershipQuery(requestId), OWNERSHIP_RESPONSE_TIMEOUT_MS)
      timer.unref()
      this.pendingQueries.set(requestId, {
        expectedWindowIds: new Set(windows.map((window) => window.id)),
        ownerWindowIds: new Set(),
        respondingWindowIds: new Set(),
        resolve: (snapshot) => resolve(snapshot ? { requestId, ...snapshot } : null),
        timer
      })

      for (const window of windows) {
        application.get('IpcApiService').send(window.id, 'navigation.conversation_ownership_requested', {
          requestId,
          target
        })
      }
    })
  }

  private settleOwnershipQuery(requestId: string): void {
    const pending = this.pendingQueries.get(requestId)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pendingQueries.delete(requestId)
    pending.resolve({
      ownerWindowIds: [...pending.ownerWindowIds],
      respondingWindowIds: [...pending.respondingWindowIds]
    })
  }

  private settleNavigationCommand(requestId: string, completed: boolean): void {
    const pending = this.pendingCommands.get(requestId)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pendingCommands.delete(requestId)
    pending.resolve(completed)
  }

  private cancelOwnershipQueries(): void {
    for (const [requestId, pending] of this.pendingQueries) {
      clearTimeout(pending.timer)
      this.pendingQueries.delete(requestId)
      pending.resolve(null)
    }
  }

  private cancelNavigationCommands(): void {
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer)
      this.pendingCommands.delete(requestId)
      pending.resolve(false)
    }
  }

  private focusWindow(windowInfo: WindowInfo): void {
    if (windowInfo.type === WindowType.Main) {
      application.get('MainWindowService').showMainWindow()
      return
    }

    const window = application.get('WindowManager').getWindow(windowInfo.id)
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
}
