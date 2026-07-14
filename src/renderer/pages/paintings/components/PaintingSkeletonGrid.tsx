import { loggerService } from '@logger'
import { decode } from 'blurhash'
import { motion, useReducedMotion } from 'motion/react'
import { type CSSProperties, type FC, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('paintings/PaintingSkeletonGrid')

/**
 * Skeleton shown while an image generates: a grid of rounded squares with a soft
 * glow wave. A wide, smooth brightness peak sweeps diagonally (bottom-left →
 * top-right); every cell loops on the same `PERIOD` with only its start `delay`
 * differing, so the wave's phase holds on every repeat. Cells stay equal-sized
 * so the wave reads as light gliding over a grid. Per-cell hash noise varies
 * each tile's lit peak and nudges its phase, and the band decays through an
 * afterglow keyframe, so the sweep reads as textured light instead of a flat
 * bar.
 *
 * When a `blurhash` arrives it is decoded to one colour per cell; the grid
 * "tints": a diagonal wave sweeps once and a solid-colour layer fades in over
 * each cell's still-running glow wave as the wave reaches it — the loading
 * wave keeps animating underneath the whole time and only disappears once the
 * tint layer occludes it, so colour arrives as a continuation of the same
 * motion instead of the wave first freezing to a flat grey and then tinting.
 * Cells the wave hasn't reached yet keep shimmering grey — a low-frequency
 * preview of the finished image. If the real image (`imageUrl`) is available
 * too — it always is, since the blurhash is decoded from that same image — a
 * second diagonal wave chases the tint wave by `SLICE_CHASE_OFFSET`: each cell
 * fades in a background-image slice of the real photo, cropped to that cell's
 * position, layered on top of the tint. Once the slice wave finishes sweeping,
 * a final full-image layer fades in over the whole grid to heal the ~5px gutters
 * the per-cell slices leave uncovered, then hands off to reveal. Grey-scale via
 * `currentColor` (light/dark adapt for free); `prefers-reduced-motion` renders a
 * static snapshot and completes the reveal immediately.
 */
const BASE_PITCH = 38 // cell + gap (px)
const GAP = 5
const RADIUS = 2.5
const PERIOD = 1.9 // one complete diagonal sweep (s)
const TINT_SWEEP = 1.35 // one-shot colour reveal sweep (s)
const ALPHA_MIN = 0.06 // baseline (unlit) opacity
const ALPHA_MAX = 0.66 // static opacity for the reduced-motion snapshot
const PEAK_MIN = 0.35 // dimmest per-cell lit peak
const PEAK_MAX = 0.85 // brightest per-cell lit peak
const AFTERGLOW = 0.25 // fraction of a cell's peak still glowing at the tail keyframe
const PHASE_JITTER = 0.1 // per-cell phase scatter, fraction of PERIOD (± half)
const TINT_MAX = 0.95 // tint layer's opacity once fully faded in — colours read solid
const TINT_DUR = 0.68 // per-cell tint-layer fade-in (s)
const MAX_CELLS = 100
// Act 3 (real-image slice wave): each cell's slice starts this far behind that
// same cell's tint delay, so the two diagonal waves sweep in lockstep with a
// constant gap instead of the slice wave waiting for the tint wave to finish.
const SLICE_CHASE_OFFSET = 0.2
const SLICE_FADE_DUR = 0.35 // per-cell slice fade-in (s)
// Act 4 (gap heal): once the slice wave's last cell finishes fading (TINT_SWEEP
// + SLICE_CHASE_OFFSET + SLICE_FADE_DUR), a single full-image layer fades in
// over this long to cover the per-cell gutters, then reveal hands off.
const HEAL_FADE_DUR = 0.4
const HEAL_START = TINT_SWEEP + SLICE_CHASE_OFFSET + SLICE_FADE_DUR // Act 3 end / Act 4 start (s)
const REVEAL_DELAY_WITH_IMAGE = HEAL_START + HEAL_FADE_DUR // onRevealReady delay once Act 4 completes (s) — ≈2.3s total

const LOOP_TIMES = [0, 0.39, 0.5, 0.68, 1] // fast attack into the peak, slower decay through the afterglow

type Grid = { cols: number; rows: number; pitch: number; cell: number }

/** Decode a blurhash to one `rgb(...)` string per grid cell (row-major), or null. */
function decodeCellColors(blurhash: string | undefined, grid: Grid | null): string[] | null {
  if (!blurhash || !grid) return null
  try {
    const px = decode(blurhash, grid.cols, grid.rows)
    const colors = new Array<string>(grid.cols * grid.rows)
    for (let i = 0; i < colors.length; i++) {
      const j = i * 4
      colors[i] = `rgb(${px[j]}, ${px[j + 1]}, ${px[j + 2]})`
    }
    return colors
  } catch (error) {
    // Decoration only — the reveal still completes without a tint (see the reveal
    // handoff effect), but a failing decode shouldn't do so silently.
    logger.warn('Failed to decode blurhash for skeleton tint', { error })
    return null
  }
}

/**
 * Deterministic per-cell noise in [0, 1). Hash-based (not `Math.random`) so a
 * cell keeps the same "random" look across re-renders and grid remounts —
 * live randomness would read as a new animation target and restart the loop,
 * reshuffling the texture mid-sweep.
 */
function cellNoise(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * One grid cell. Memoized so ordinary parent re-renders (e.g. generation
 * progress updates) do not rebuild the cell tree; grid geometry changes are
 * handled by remounting the grid below so Motion restarts with fresh delays.
 *
 * The loading glow wave is rendered unconditionally as the base layer, in the
 * same tree position, for the cell's entire lifetime — tint and slice are
 * separate layers that fade in *on top* of it instead of replacing it. That
 * keeps the wave's Motion instance alive and still animating through the
 * tint/slice hand-off (no prop-driven remount to interrupt or freeze it); it
 * simply becomes invisible once an opaque layer occludes it.
 */
const Cell: FC<{
  size: number
  litColor: string | undefined
  reduceMotion: boolean
  phaseDelay: number
  tintDelay: number
  peak: number
  sliceUrl?: string
  sliceBackgroundSize?: string
  sliceBackgroundPosition?: string
  sliceDelay?: number
}> = memo(
  ({
    size,
    litColor,
    reduceMotion,
    phaseDelay,
    tintDelay,
    peak,
    sliceUrl,
    sliceBackgroundSize,
    sliceBackgroundPosition,
    sliceDelay
  }) => {
    const baseStyle: CSSProperties = { width: size, height: size, borderRadius: RADIUS }

    if (reduceMotion) {
      return (
        <div
          style={{
            ...baseStyle,
            backgroundColor: litColor ?? 'currentColor',
            opacity: litColor ? TINT_MAX : ALPHA_MAX
          }}
        />
      )
    }

    // Loading: soft glow wave (grey), looping. `peak` varies per cell so each
    // sweep glints unevenly across the tiles; the afterglow keyframe lets the
    // band trail off instead of cutting straight back to the baseline. Always
    // wrapped in the same `position: relative` container (even with no tint/
    // slice layers yet) so this stays the same tree shape across the cell's
    // whole lifetime — swapping wrapper types would remount the shimmer.
    const shimmer = (
      <motion.div
        style={{ ...baseStyle, backgroundColor: 'currentColor' }}
        initial={{ opacity: ALPHA_MIN }}
        animate={{ opacity: [ALPHA_MIN, ALPHA_MIN, peak, ALPHA_MIN + (peak - ALPHA_MIN) * AFTERGLOW, ALPHA_MIN] }}
        transition={{
          duration: PERIOD,
          delay: phaseDelay,
          times: LOOP_TIMES,
          ease: 'easeInOut',
          repeat: Number.POSITIVE_INFINITY,
          repeatDelay: 0
        }}
      />
    )

    // Act 2: a one-shot diagonal wave, a solid tint layer fades in over the
    // still-running shimmer as the wave reaches this cell.
    const tintLayer = litColor && (
      <motion.div
        style={{ ...baseStyle, position: 'absolute', inset: 0, backgroundColor: litColor }}
        initial={{ opacity: 0 }}
        animate={{ opacity: TINT_MAX }}
        transition={{ duration: TINT_DUR, delay: tintDelay, ease: 'easeInOut' }}
      />
    )

    // Act 3: a real-image slice layered on top of that, chasing the tint wave
    // by SLICE_CHASE_OFFSET. `sliceBackgroundSize` covers the whole grid so
    // `sliceBackgroundPosition`'s per-cell negative offset crops this cell's
    // own slice out of the same shared image.
    const sliceLayer = sliceUrl && (
      <motion.div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS,
          backgroundImage: `url(${sliceUrl})`,
          backgroundSize: sliceBackgroundSize,
          backgroundPosition: sliceBackgroundPosition
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: SLICE_FADE_DUR, delay: sliceDelay, ease: 'easeInOut' }}
      />
    )

    return (
      <div style={{ position: 'relative', width: size, height: size }}>
        {shimmer}
        {tintLayer}
        {sliceLayer}
      </div>
    )
  }
)

const PaintingSkeletonGrid: FC<{ blurhash?: string; imageUrl?: string; onRevealReady?: () => void }> = ({
  blurhash,
  imageUrl,
  onRevealReady
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const [grid, setGrid] = useState<Grid | null>(null)
  const [tinted, setTinted] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      // Grow the pitch on a very large artboard to keep the cell count bounded.
      let pitch = BASE_PITCH
      while (Math.floor(width / pitch) * Math.floor(height / pitch) > MAX_CELLS) pitch += 2
      const cols = Math.floor(width / pitch)
      const rows = Math.floor(height / pitch)
      setGrid((prev) =>
        prev && prev.cols === cols && prev.rows === rows && prev.pitch === pitch
          ? prev
          : { cols, rows, pitch, cell: pitch - GAP }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const colors = useMemo(() => decodeCellColors(blurhash, grid), [blurhash, grid])

  // Start the one-shot tint reveal as soon as decoded colours are available.
  useEffect(() => {
    setTinted(Boolean(colors))
  }, [colors])

  // Hand off once the reveal's animation window has elapsed. With a real image to
  // chase (Act 3 slice wave + Act 4 gap heal) that window is longer; without one
  // it hands off right after the tint wave. Runs purely on `onRevealReady` being
  // provided — the artboard wires it only once the reveal is `ready` (a blurhash
  // has arrived), never during the pending phase, so the timer can't arm before
  // the blurhash resolves and race a slow computation into a double reveal. It is
  // deliberately independent of `tinted` (decode success): the tint is decoration,
  // so a blurhash that fails to *decode* still completes the reveal instead of
  // pinning the skeleton over the finished image forever.
  useEffect(() => {
    if (!onRevealReady) return
    if (reduceMotion) {
      onRevealReady()
      return
    }
    const revealDelay = imageUrl ? REVEAL_DELAY_WITH_IMAGE : TINT_SWEEP + TINT_DUR
    const id = setTimeout(onRevealReady, revealDelay * 1000)
    return () => clearTimeout(id)
  }, [reduceMotion, onRevealReady, imageUrl])

  const gridKey = grid ? `${grid.cols}x${grid.rows}` : null
  // Act 3's per-cell backgroundPosition crops out of one shared canvas the size
  // of the whole grid (in pitch units, not the slightly-narrower rendered
  // width) — see the module doc comment for why that leaves gutters Act 4 heals.
  const sliceBackgroundSize = grid ? `${grid.cols * grid.pitch}px ${grid.rows * grid.pitch}px` : undefined
  const showSlices = Boolean(imageUrl && tinted && !reduceMotion)

  return (
    <div
      ref={ref}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ color: 'var(--color-foreground)' }}>
      {grid && (
        <div
          key={gridKey}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${grid.cols}, ${grid.cell}px)`,
            gridAutoRows: `${grid.cell}px`,
            gap: `${GAP}px`
          }}>
          {Array.from({ length: grid.cols * grid.rows }, (_, i) => {
            const c = i % grid.cols
            const r = Math.floor(i / grid.cols)
            const diag = c + (grid.rows - 1 - r) // bottom-left → top-right
            const maxDiag = Math.max(1, grid.cols + grid.rows - 2)
            // Each cell's start delay is a phase offset that ramps linearly with
            // its diagonal, so — read modulo the loop's PERIOD — the brightness
            // peak glides across the diagonals from diag=0 (bottom-left) to
            // diag=maxDiag (top-right). The base offset is negative only to seed
            // that phase, so the wave is already mid-sweep at t=0 instead of
            // waiting a full period first (on an infinite loop -PERIOD is
            // congruent to 0). The jitter scatters each cell slightly off its
            // diagonal so the band's edge shimmers instead of ruling a straight line.
            const jitter = (cellNoise(i, 2) - 0.5) * PHASE_JITTER * PERIOD
            const phaseDelay = -((maxDiag - diag) / maxDiag) * PERIOD + jitter
            const tintDelay = (diag / maxDiag) * TINT_SWEEP
            const litColor = (tinted || reduceMotion) && colors ? colors[i] : undefined
            return (
              <Cell
                key={i}
                size={grid.cell}
                litColor={litColor}
                reduceMotion={Boolean(reduceMotion)}
                phaseDelay={phaseDelay}
                tintDelay={tintDelay}
                peak={PEAK_MIN + (PEAK_MAX - PEAK_MIN) * cellNoise(i, 1)}
                sliceUrl={showSlices ? imageUrl : undefined}
                sliceBackgroundSize={showSlices ? sliceBackgroundSize : undefined}
                sliceBackgroundPosition={showSlices ? `${-(c * grid.pitch)}px ${-(r * grid.pitch)}px` : undefined}
                sliceDelay={showSlices ? tintDelay + SLICE_CHASE_OFFSET : undefined}
              />
            )
          })}
        </div>
      )}
      {showSlices && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: HEAL_FADE_DUR, delay: HEAL_START, ease: 'easeInOut' }}
        />
      )}
    </div>
  )
}

export default PaintingSkeletonGrid
