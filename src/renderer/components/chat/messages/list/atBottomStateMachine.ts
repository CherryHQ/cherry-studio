export const DEFAULT_AT_BOTTOM_TOLERANCE_PX = 100

export type AtBottomReason = 'initial' | 'scrolled-to-bottom' | 'stuck-on-grow' | 'size-stayed-at-bottom'

export type NotAtBottomReason = 'initial' | 'user-scrolled-up' | 'scrolled-not-bottom' | 'size-grew-past-viewport'

export type AtBottomState =
  | { readonly atBottom: true; readonly reason: AtBottomReason }
  | { readonly atBottom: false; readonly reason: NotAtBottomReason }

export type AtBottomInput =
  | {
      readonly type: 'measure'
      readonly offset: number
      readonly scrollSize: number
      readonly viewportSize: number
    }
  | {
      readonly type: 'user-scroll'
      readonly offset: number
      readonly scrollSize: number
      readonly viewportSize: number
      readonly direction: 'up' | 'down' | 'none'
      /**
       * Whether a real user input (wheel / touch / pointer) immediately preceded
       * this scroll event. Programmatic scrolls (virtua remeasure compensation,
       * a child `scrollIntoView`) fire the same events without one.
       */
      readonly userInitiated: boolean
    }
  | {
      readonly type: 'size-change'
      readonly offset: number
      readonly scrollSize: number
      readonly viewportSize: number
    }
  | { readonly type: 'programmatic-stick' }
  /**
   * The user explicitly took reading control without scrolling — e.g. expanded a
   * collapsible block to read it. Latches `user-scrolled-up` so neither size
   * changes nor programmatic scrolls within tolerance re-engage auto-stick;
   * only a real return to the bottom (user-scroll) or a programmatic stick does.
   */
  | { readonly type: 'user-took-control' }
  | { readonly type: 'reset' }

export const INITIAL_AT_BOTTOM_STATE: AtBottomState = { atBottom: false, reason: 'initial' }

export function isCloseToBottom(
  offset: number,
  scrollSize: number,
  viewportSize: number,
  tolerance: number = DEFAULT_AT_BOTTOM_TOLERANCE_PX
): boolean {
  return scrollSize - offset - viewportSize <= tolerance
}

/**
 * Should the runtime auto-scroll to bottom when content has grown?
 *
 * Returns true only when the previous state had the user pinned to the
 * bottom — i.e. they were already there, or we put them there. If the user
 * actively scrolled up, we leave them alone even if growth happens.
 */
export function shouldStickOnGrow(state: AtBottomState): boolean {
  return state.atBottom
}

export function reduceAtBottom(
  state: AtBottomState,
  input: AtBottomInput,
  tolerance: number = DEFAULT_AT_BOTTOM_TOLERANCE_PX
): AtBottomState {
  switch (input.type) {
    case 'reset':
      return INITIAL_AT_BOTTOM_STATE

    case 'user-took-control':
      return state.atBottom || state.reason !== 'user-scrolled-up'
        ? { atBottom: false, reason: 'user-scrolled-up' }
        : state

    case 'programmatic-stick':
      return { atBottom: true, reason: 'stuck-on-grow' }

    case 'measure': {
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
        return state.atBottom ? state : { atBottom: true, reason: 'size-stayed-at-bottom' }
      }
      return state.atBottom ? { atBottom: false, reason: 'scrolled-not-bottom' } : state
    }

    case 'user-scroll': {
      // An upward USER gesture is intent to read — it must never (re-)latch
      // at-bottom, even within tolerance. Right after a top-pin releases, the
      // pinned viewport still measures within (even past) the effective bottom,
      // so without this a small upward wheel would hand the turn straight to
      // bottom-follow. Programmatic upward jumps (virtua remeasure compensation
      // mid-stream) are NOT user intent and keep the in-tolerance latch below,
      // so they can't kill an active follow.
      if (input.direction === 'up' && input.userInitiated) {
        return { atBottom: false, reason: 'user-scrolled-up' }
      }
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
        // Reaching the bottom (other than by a user upward gesture) always
        // resumes auto-stick, regardless of prior user-scrolled-up latch.
        return state.atBottom && state.reason === 'scrolled-to-bottom'
          ? state
          : { atBottom: true, reason: 'scrolled-to-bottom' }
      }
      // Only an upward scroll counts as "user wants out of auto-follow".
      // Downward scrolls that don't reach the bottom can be the end-of-animation
      // event firing after newer chunks arrived (programmatic, not user intent);
      // latching user-scrolled-up here would kill subsequent auto-stick.
      if (input.direction === 'up') {
        return { atBottom: false, reason: 'user-scrolled-up' }
      }
      // direction 'down'/'none' that doesn't reach the bottom — keep a prior
      // user-intent latch. Programmatic forward jumps (virtua remeasure
      // compensation) report 'down' with no user input; clearing the latch would
      // let the next in-tolerance size change re-engage auto-stick.
      if (!state.atBottom && state.reason === 'user-scrolled-up') return state
      return { atBottom: false, reason: 'scrolled-not-bottom' }
    }

    case 'size-change': {
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
        // A user-intent latch survives geometry: sitting within tolerance after
        // a size change (a short expanded block near the live edge) is not the
        // user returning to the bottom. Only a real scroll back down or a
        // programmatic stick re-engages auto-stick.
        if (!state.atBottom && state.reason === 'user-scrolled-up') return state
        return state.atBottom ? state : { atBottom: true, reason: 'size-stayed-at-bottom' }
      }
      // Size grew (or shrank) and we're no longer at the bottom. If the
      // previous state was at-bottom, the new content pushed us up; the
      // caller should auto-stick. If the previous state was a user-intent
      // latch, preserve it so we don't accidentally clear it.
      if (!state.atBottom && state.reason === 'user-scrolled-up') return state
      if (state.atBottom) return { atBottom: false, reason: 'size-grew-past-viewport' }
      return { atBottom: false, reason: 'scrolled-not-bottom' }
    }
  }
}
