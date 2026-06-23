import { createContext, type ReactNode, use } from 'react'

/** Outer width of the centered message column (NarrowLayout `withSidePadding`, max-w-[calc(800px+3rem)]). */
export const CHAT_COLUMN_MAX_PX = 848
/** Navbar height in the embedded chat layout (`--navbar-height` in responsive.css). */
const NAVBAR_HEIGHT_PX = 44
/** Navbar height in detached window mode (the window title bar; see titleBar.ts). */
const WINDOW_NAVBAR_HEIGHT_PX = 37.5
/**
 * Minimum total side room (both gutters combined) the centered column needs before the navbar may
 * float. Window mode reserves more — the macOS traffic-light inset on the left and the
 * pin/back/tool cluster on the right. These only gate WHEN floating may start; once floating, a CSS
 * clamp keeps the navbar's edge clusters inside the gutters regardless (the title truncates), so the
 * values just need to be generous enough that the clusters stay usable.
 */
const IMMERSIVE_GUTTER_RESERVE_PX = { embedded: 116, window: 208 } as const

export interface ImmersiveNavbarState {
  /** The navbar floats over the list; the list pads its top by `insetHeight` to match. */
  floating: boolean
  /** Top inset the list reserves for the floating navbar; `0` when not floating. */
  insetHeight: number
}

const NOT_IMMERSIVE: ImmersiveNavbarState = { floating: false, insetHeight: 0 }

/**
 * Decide whether the navbar floats over the centered message column, from a single measured width
 * and one declared flag. It floats when the column is narrow (centered) and the center is wide
 * enough to leave room for the navbar's edge clusters; a CSS clamp then keeps those clusters inside
 * the side gutters so they can never overlap the column.
 */
export function resolveImmersiveNavbar({
  narrow,
  centerWidth,
  isWindow
}: {
  narrow: boolean
  centerWidth: number
  isWindow: boolean
}): ImmersiveNavbarState {
  const reserve = isWindow ? IMMERSIVE_GUTTER_RESERVE_PX.window : IMMERSIVE_GUTTER_RESERVE_PX.embedded
  if (!narrow || centerWidth < CHAT_COLUMN_MAX_PX + reserve) return NOT_IMMERSIVE
  return { floating: true, insetHeight: isWindow ? WINDOW_NAVBAR_HEIGHT_PX : NAVBAR_HEIGHT_PX }
}

const ImmersiveNavbarStateContext = createContext<ImmersiveNavbarState>(NOT_IMMERSIVE)

export function ImmersiveNavbarStateProvider({
  value,
  children
}: {
  value: ImmersiveNavbarState
  children: ReactNode
}) {
  return <ImmersiveNavbarStateContext value={value}>{children}</ImmersiveNavbarStateContext>
}

/** Consumed by the navbar wrapper (floating?) and the message list (top inset). */
export function useImmersiveNavbar() {
  return use(ImmersiveNavbarStateContext)
}

type ReportImmersiveNarrow = (narrow: boolean) => void

const ImmersiveNarrowReportContext = createContext<ReportImmersiveNarrow>(() => {})

export function ImmersiveNarrowReportProvider({
  value,
  children
}: {
  value: ReportImmersiveNarrow
  children: ReactNode
}) {
  return <ImmersiveNarrowReportContext value={value}>{children}</ImmersiveNarrowReportContext>
}

/** The message list publishes whether its column is rendered narrow (centered); the shell owns the rest. */
export function useReportImmersiveNarrow() {
  return use(ImmersiveNarrowReportContext)
}
