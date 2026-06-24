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
    }
  | {
      readonly type: 'size-change'
      readonly offset: number
      readonly scrollSize: number
      readonly viewportSize: number
    }
  | { readonly type: 'programmatic-stick' }
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
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
        // Reaching the bottom always resumes auto-stick, regardless of prior
        // user-scrolled-up latch.
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
      // direction 'none' (programmatic) — keep prior reason if we already had
      // a user-intent latch; otherwise note the position only.
      if (!state.atBottom && state.reason === 'user-scrolled-up') return state
      return { atBottom: false, reason: 'scrolled-not-bottom' }
    }

    case 'size-change': {
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
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
