import { cn } from '@cherrystudio/ui/lib/utils'

/**
 * Closed, statically-analyzable class lookups shared by every layout primitive.
 *
 * Every value is a literal Tailwind class string so the JIT compiler can detect
 * it — NEVER build a class with template interpolation (`gap-${n}`), or the class
 * will be silently dropped from the bundle.
 *
 * `gap` binds to the numeric Tailwind 4px scale only (no `--cs-size-*`, no
 * semantic `gap-md` — those aliases are commented out in `theme.css`). Half-steps
 * (1.25/1.5/2.5/0.5) are intentionally excluded so the codebase converges; for a
 * genuinely off-scale value drop to `className` (`gap-[6px]`).
 */

export type GapToken = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8
export type GapProp = GapToken | { x?: GapToken; y?: GapToken }
export type FlexDirection = 'row' | 'col'
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type FlexJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
export type GridFlow = 'row' | 'col'
export type GridColumnCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
export type GridColumns =
  | GridColumnCount
  | { base?: GridColumnCount; sm?: GridColumnCount; md?: GridColumnCount; lg?: GridColumnCount; xl?: GridColumnCount }

const GAP: Record<GapToken, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8'
}
const GAP_X: Record<GapToken, string> = {
  0: 'gap-x-0',
  1: 'gap-x-1',
  2: 'gap-x-2',
  3: 'gap-x-3',
  4: 'gap-x-4',
  5: 'gap-x-5',
  6: 'gap-x-6',
  8: 'gap-x-8'
}
const GAP_Y: Record<GapToken, string> = {
  0: 'gap-y-0',
  1: 'gap-y-1',
  2: 'gap-y-2',
  3: 'gap-y-3',
  4: 'gap-y-4',
  5: 'gap-y-5',
  6: 'gap-y-6',
  8: 'gap-y-8'
}

const DIRECTION: Record<FlexDirection, string> = { row: 'flex-row', col: 'flex-col' }
const ALIGN: Record<FlexAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline'
}
const JUSTIFY: Record<FlexJustify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly'
}

export function resolveGap(gap?: GapProp): string | undefined {
  if (gap === undefined) return undefined
  if (typeof gap === 'number') return GAP[gap]
  return cn(gap.x !== undefined && GAP_X[gap.x], gap.y !== undefined && GAP_Y[gap.y])
}

export interface FlexShape {
  /** Flex direction. */
  direction?: FlexDirection
  /** `align-items`. */
  align?: FlexAlign
  /** `justify-content`. */
  justify?: FlexJustify
  /** Sibling gap, bound to the numeric Tailwind scale. Use `{ x, y }` for axis-specific gaps. */
  gap?: GapProp
  /** Enable `flex-wrap`. */
  wrap?: boolean
  /** Render as `inline-flex` instead of `flex`. */
  inline?: boolean
}

export function flexClasses({ direction, align, justify, gap, wrap, inline }: FlexShape): string {
  return cn(
    inline ? 'inline-flex' : 'flex',
    direction && DIRECTION[direction],
    align && ALIGN[align],
    justify && JUSTIFY[justify],
    resolveGap(gap),
    wrap && 'flex-wrap'
  )
}

const GRID_COLS_BASE: Record<GridColumnCount, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
  9: 'grid-cols-9',
  10: 'grid-cols-10',
  11: 'grid-cols-11',
  12: 'grid-cols-12'
}
const GRID_COLS_SM: Record<GridColumnCount, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
  7: 'sm:grid-cols-7',
  8: 'sm:grid-cols-8',
  9: 'sm:grid-cols-9',
  10: 'sm:grid-cols-10',
  11: 'sm:grid-cols-11',
  12: 'sm:grid-cols-12'
}
const GRID_COLS_MD: Record<GridColumnCount, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
  7: 'md:grid-cols-7',
  8: 'md:grid-cols-8',
  9: 'md:grid-cols-9',
  10: 'md:grid-cols-10',
  11: 'md:grid-cols-11',
  12: 'md:grid-cols-12'
}
const GRID_COLS_LG: Record<GridColumnCount, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
  7: 'lg:grid-cols-7',
  8: 'lg:grid-cols-8',
  9: 'lg:grid-cols-9',
  10: 'lg:grid-cols-10',
  11: 'lg:grid-cols-11',
  12: 'lg:grid-cols-12'
}
const GRID_COLS_XL: Record<GridColumnCount, string> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
  7: 'xl:grid-cols-7',
  8: 'xl:grid-cols-8',
  9: 'xl:grid-cols-9',
  10: 'xl:grid-cols-10',
  11: 'xl:grid-cols-11',
  12: 'xl:grid-cols-12'
}
const GRID_FLOW: Record<GridFlow, string> = { row: 'grid-flow-row', col: 'grid-flow-col' }

export function gridColumnsClasses(columns?: GridColumns): string | undefined {
  if (columns === undefined) return undefined
  if (typeof columns === 'number') return GRID_COLS_BASE[columns]
  return cn(
    columns.base !== undefined && GRID_COLS_BASE[columns.base],
    columns.sm !== undefined && GRID_COLS_SM[columns.sm],
    columns.md !== undefined && GRID_COLS_MD[columns.md],
    columns.lg !== undefined && GRID_COLS_LG[columns.lg],
    columns.xl !== undefined && GRID_COLS_XL[columns.xl]
  )
}

export function gridFlowClass(flow?: GridFlow): string | undefined {
  return flow ? GRID_FLOW[flow] : undefined
}
