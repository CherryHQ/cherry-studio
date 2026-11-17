import { trackProductEvent } from '@renderer/services/productAnalytics'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import type { AnalyticsPage, RendererAnalyticsEvent } from '@shared/ipc/schemas/analytics'

/** Usage-behavior reporting: page dwell time and clicks. Only static identifiers ever leave the window. */

export interface AnalyticsView {
  /** Identity of the viewed surface (tab id or window name); never reported. */
  key: string
  page: AnalyticsPage
  subpage?: string
}

const APP_PAGES: Record<string, AnalyticsPage> = {
  chat: 'chat',
  agents: 'agents',
  paintings: 'paintings',
  translate: 'translate',
  knowledge: 'knowledge',
  notes: 'notes',
  files: 'files',
  'file-preview': 'files',
  code: 'code',
  browser: 'browser',
  'mini-app': 'mini_app',
  launchpad: 'launchpad',
  marketplace: 'marketplace',
  'scheduled-tasks': 'scheduled_tasks',
  'release-notes': 'release_notes'
}
const BUILTIN_MINI_APP_IDS = new Set(PRESETS_MINI_APPS.map((app) => app.id))
// Settings sections are static first-level route names; dynamic ids only appear below them.
const SETTINGS_SECTION = /^[a-z][a-z-]{0,39}$/
const UI_TOKEN = /^[a-z0-9][a-z0-9:._-]{0,119}$/

/** Maps a tab to a catalogued page; ids, query strings, and web addresses never pass through. */
export function toAnalyticsPage(tab: Pick<Tab, 'type' | 'url'>): Omit<AnalyticsView, 'key'> {
  if (tab.type === 'webview') return { page: 'webview' }
  let segments: string[]
  try {
    segments = new URL(tab.url, 'app://renderer').pathname.split('/').filter(Boolean)
  } catch {
    return { page: 'other' }
  }
  const [root, first, second] = segments
  if (root === 'settings') {
    return SETTINGS_SECTION.test(first ?? '') ? { page: 'settings', subpage: first } : { page: 'settings' }
  }
  if (root !== 'app' || !first) return { page: 'other' }
  const page = APP_PAGES[first] ?? 'other'
  // Built-in ids outside the event's id pattern (e.g. 'Felo') would make main reject the whole event.
  if (page === 'mini_app' && second && BUILTIN_MINI_APP_IDS.has(second) && UI_TOKEN.test(second)) {
    return { page, subpage: second }
  }
  return { page }
}

let currentPage: AnalyticsPage = 'other'

/** The page clicks are attributed to in this window. */
export function setUsageAnalyticsPage(page: AnalyticsPage): void {
  currentPage = page
}

type PageViewedEvent = Extract<RendererAnalyticsEvent, { event: 'page_viewed' }>
type EndReason = PageViewedEvent['endReason']

const ACTIVE_INPUT_WINDOW_MS = 60_000
const IDLE_TIMEOUT_MS = 30 * 60_000
const SEGMENT_CAP_MS = 4 * 60 * 60_000
const MIN_SEGMENT_MS = 1_000
const INPUT_THROTTLE_MS = 1_000
const IDLE_CHECK_MS = 60_000

interface Segment {
  view: AnalyticsView
  startedAt: number
  activeMs: number
  accruedAt: number
}

/**
 * Times one viewed surface at a time. Active time accrues only while the window is focused, the document is
 * visible, and there was input in the last minute; 30 minutes without input ends the segment.
 */
export class PageDwellTracker {
  private segment: Segment | null = null
  private view: AnalyticsView | null = null
  private previousPage: AnalyticsPage | undefined
  private focused: boolean
  private visible: boolean
  private lastInputAt: number

  constructor(
    private readonly report: (event: PageViewedEvent) => void = trackProductEvent,
    private readonly now: () => number = Date.now,
    state: { focused: boolean; visible: boolean } = { focused: true, visible: true }
  ) {
    this.focused = state.focused
    this.visible = state.visible
    this.lastInputAt = now()
  }

  /** Switches the viewed surface; `reason` explains why the previous one ended. */
  show(view: AnalyticsView | null, reason: EndReason): void {
    const current = this.view
    if (current && view && current.key === view.key && current.page === view.page && current.subpage === view.subpage) {
      return
    }
    this.end(reason)
    this.view = view
    this.begin()
  }

  input(): void {
    const now = this.now()
    if (!this.segment) {
      this.lastInputAt = now
      this.begin()
      return
    }
    this.accrue(now)
    this.lastInputAt = now
  }

  setFocused(focused: boolean): void {
    this.accrue(this.now())
    this.focused = focused
    if (focused) this.input()
  }

  setVisible(visible: boolean): void {
    if (!visible) {
      this.end('window_hidden')
      this.visible = false
      return
    }
    this.visible = true
    this.input()
  }

  /** Ends a segment that has gone 30 minutes without input; call periodically. */
  checkIdle(): void {
    if (this.segment && this.now() - this.lastInputAt >= IDLE_TIMEOUT_MS) this.end('idle_timeout')
  }

  end(reason: EndReason): void {
    const segment = this.segment
    if (!segment) return
    const now = this.now()
    this.accrue(now)
    this.segment = null
    const elapsed = now - segment.startedAt
    if (elapsed < MIN_SEGMENT_MS) return
    const { page, subpage } = segment.view
    this.report({
      event: 'page_viewed',
      page,
      ...(this.previousPage && { previousPage: this.previousPage }),
      ...(subpage && { subpage }),
      durationMs: Math.min(elapsed, SEGMENT_CAP_MS),
      activeMs: Math.min(segment.activeMs, SEGMENT_CAP_MS),
      endReason: reason,
      capped: elapsed > SEGMENT_CAP_MS
    })
    this.previousPage = page
  }

  private begin(): void {
    if (!this.view || !this.visible || this.segment) return
    const now = this.now()
    this.segment = { view: this.view, startedAt: now, activeMs: 0, accruedAt: now }
  }

  private accrue(now: number): void {
    const segment = this.segment
    if (!segment) return
    if (this.focused && this.visible) {
      const activeUntil = Math.min(now, this.lastInputAt + ACTIVE_INPUT_WINDOW_MS)
      if (activeUntil > segment.accruedAt) segment.activeMs += activeUntil - segment.accruedAt
    }
    segment.accruedAt = now
  }
}

/** Wires a tracker to this window's focus, visibility, input, and unload signals. */
export function attachPageDwellTracker(tracker: PageDwellTracker, target: Window = window): () => void {
  let lastInput = 0
  const onInput = () => {
    const now = Date.now()
    if (now - lastInput < INPUT_THROTTLE_MS) return
    lastInput = now
    tracker.input()
  }
  const onFocus = () => tracker.setFocused(true)
  const onBlur = () => tracker.setFocused(false)
  const onVisibility = () => tracker.setVisible(target.document.visibilityState === 'visible')
  const onLeave = () => tracker.end('app_quit')
  const inputEvents = ['keydown', 'pointerdown', 'wheel'] as const
  for (const type of inputEvents) target.addEventListener(type, onInput, { capture: true, passive: true })
  target.addEventListener('focus', onFocus)
  target.addEventListener('blur', onBlur)
  target.document.addEventListener('visibilitychange', onVisibility)
  target.addEventListener('pagehide', onLeave)
  target.addEventListener('beforeunload', onLeave)
  const idleTimer = target.setInterval(() => tracker.checkIdle(), IDLE_CHECK_MS)
  return () => {
    for (const type of inputEvents) target.removeEventListener(type, onInput, { capture: true })
    target.removeEventListener('focus', onFocus)
    target.removeEventListener('blur', onBlur)
    target.document.removeEventListener('visibilitychange', onVisibility)
    target.removeEventListener('pagehide', onLeave)
    target.removeEventListener('beforeunload', onLeave)
    target.clearInterval(idleTimer)
  }
}

const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'select',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="button"]',
  'input[type="submit"]',
  ...[
    'button',
    'link',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'checkbox',
    'switch',
    'option',
    'radio'
  ].map((role) => `[role="${role}"]`)
].join(', ')
const CLICK_DEDUPE_MS = 500

type ClickElement = Extract<RendererAnalyticsEvent, { event: 'ui_clicked' }>['element']

function elementKind(element: Element): ClickElement {
  const role = element.getAttribute('role')
  if (role?.startsWith('menuitem')) return 'menuitem'
  if (role === 'button' || role === 'link' || role === 'tab' || role === 'checkbox' || role === 'switch') {
    return role
  }
  if (role === 'option') return 'option'
  // Same kind as a native radio input, which reports as 'input' below.
  if (role === 'radio') return 'input'
  switch (element.tagName) {
    case 'BUTTON':
      return 'button'
    case 'A':
      return 'link'
    case 'SELECT':
      return 'input'
    case 'INPUT': {
      const type = element.getAttribute('type')
      if (type === 'checkbox') return 'checkbox'
      return type === 'button' || type === 'submit' ? 'button' : 'input'
    }
    default:
      return 'other'
  }
}

// Reads only data-ui attributes: the nearest role token, else the nearest part token (bare buttons carry parts only).
function uiTokenOf(element: Element): string {
  let part: string | undefined
  for (let node = element.closest('[data-ui]'); node; node = node.parentElement?.closest('[data-ui]') ?? null) {
    const tokens = node.getAttribute('data-ui')?.split(/\s+/).filter(Boolean) ?? []
    const role = tokens.find((value) => !value.startsWith('part:'))
    if (role) return UI_TOKEN.test(role) ? role : 'unlabeled'
    part ??= tokens[0]
  }
  return part && UI_TOKEN.test(part) ? part : 'unlabeled'
}

// The static data-analytics name on the control or a wrapper it renders inside, never another control's.
function analyticsNameOf(control: Element): string | undefined {
  const named = control.closest('[data-analytics]')
  if (!named || (named !== control && named.matches(INTERACTIVE_SELECTOR))) return undefined
  const name = named.getAttribute('data-analytics') ?? ''
  return UI_TOKEN.test(name) ? name : undefined
}

/** Reports clicks on interactive controls by their static analytics name or data-ui token, without reading any content. */
export function installUiClickTracker(
  target: Document = document,
  report: (event: Extract<RendererAnalyticsEvent, { event: 'ui_clicked' }>) => void = trackProductEvent
): () => void {
  let last: { ui: string; at: number } | null = null
  const onClick = (event: MouseEvent) => {
    try {
      const control = event.target instanceof Element ? event.target.closest(INTERACTIVE_SELECTOR) : null
      if (!control) return
      const ui = analyticsNameOf(control) ?? uiTokenOf(control)
      const now = Date.now()
      if (last && last.ui === ui && now - last.at < CLICK_DEDUPE_MS) return
      last = { ui, at: now }
      report({
        event: 'ui_clicked',
        ui,
        page: currentPage,
        element: elementKind(control),
        input: event.detail === 0 ? 'keyboard' : 'pointer'
      })
    } catch {
      // Click reporting never interferes with the click itself.
    }
  }
  target.addEventListener('click', onClick, true)
  return () => target.removeEventListener('click', onClick, true)
}
