import { loggerService } from '@logger'
import { getImageBlobFromSource } from '@renderer/utils/image'
import { motion, useReducedMotion } from 'motion/react'
import {
  type CSSProperties,
  type FC,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

const logger = loggerService.withContext('paintings/PaintingSkeletonSurface')

const DEFAULT_CELL_SIZE = 14
const DEFAULT_CELL_GAP = 14
const COMPACT_CELL_SIZE = 6
const COMPACT_CELL_GAP = 6
const COMPACT_SURFACE_MAX_SIZE = 64
const MAX_GRID_CELLS = 256
const CELL_RADIUS = 3
const BLINK_DURATION_MS = 2000
const CELL_FILL_DURATION = 0.5
const CELL_FADE_DURATION_MS = 600
const CELL_FADE_DELAY_MAX_MS = 300
const IMAGE_REVEAL_DURATION = 0.9

type Grid = {
  cellGap: number
  cellSize: number
  cols: number
  layoutKey: string
  offsetX: number
  offsetY: number
  pitch: number
  radius: number
  rows: number
}

type GridCell = {
  blinkDelayMs: number
  fadeDelayMs: number
  id: string
  initialOpacity: number
  x: number
  y: number
}

type SampledColors = {
  colors: string[]
  key: string
}

function cellNoise(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function createGrid(width: number, height: number): Grid {
  const compact = Math.min(width, height) <= COMPACT_SURFACE_MAX_SIZE
  const cellSize = compact ? COMPACT_CELL_SIZE : DEFAULT_CELL_SIZE
  const baseGap = compact ? COMPACT_CELL_GAP : DEFAULT_CELL_GAP
  let pitch = cellSize + baseGap
  let cols = Math.max(1, Math.ceil(width / pitch))
  let rows = Math.max(1, Math.ceil(height / pitch))

  while (cols * rows > MAX_GRID_CELLS) {
    pitch += 1
    cols = Math.max(1, Math.ceil(width / pitch))
    rows = Math.max(1, Math.ceil(height / pitch))
  }

  const cellGap = pitch - cellSize
  const offsetX = (width - ((cols - 1) * pitch + cellSize)) / 2
  const offsetY = (height - ((rows - 1) * pitch + cellSize)) / 2
  const radius = compact ? 2 : CELL_RADIUS

  return {
    cellGap,
    cellSize,
    cols,
    layoutKey: `${cols}x${rows}:${cellSize}:${pitch}:${offsetX}:${offsetY}`,
    offsetX,
    offsetY,
    pitch,
    radius,
    rows
  }
}

async function downsampleCellColors(src: string, grid: Pick<Grid, 'cols' | 'rows'>): Promise<string[] | null> {
  let bitmap: ImageBitmap | null = null
  try {
    const blob = await getImageBlobFromSource(src)
    bitmap = await createImageBitmap(blob)

    const canvas = document.createElement('canvas')
    canvas.width = grid.cols
    canvas.height = grid.rows
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      logger.warn('Failed to acquire 2d canvas context for painting loader')
      return null
    }

    context.drawImage(bitmap, 0, 0, grid.cols, grid.rows)
    const { data } = context.getImageData(0, 0, grid.cols, grid.rows)
    return Array.from({ length: grid.cols * grid.rows }, (_, index) => {
      const offset = index * 4
      return `rgb(${data[offset]}, ${data[offset + 1]}, ${data[offset + 2]})`
    })
  } catch (error) {
    logger.warn('Failed to sample image colors for painting loader', { error })
    return null
  } finally {
    bitmap?.close()
  }
}

const Cell: FC<{
  cell: GridCell
  color?: string
  fading: boolean
  grid: Grid
  ready: boolean
  reduceMotion: boolean
}> = memo(({ cell, color, fading, grid, ready, reduceMotion }) => {
  const style: CSSProperties = ready
    ? {
        animationName: 'none',
        backgroundColor: color ?? 'var(--muted-foreground)',
        borderRadius: grid.radius,
        height: grid.pitch,
        left: cell.x - grid.cellGap / 2,
        opacity: fading ? 0 : 1,
        position: 'absolute',
        top: cell.y - grid.cellGap / 2,
        transition: fading
          ? `opacity ${CELL_FADE_DURATION_MS}ms ease`
          : [
              `background-color ${CELL_FILL_DURATION}s ease`,
              `height ${CELL_FILL_DURATION}s ease`,
              `left ${CELL_FILL_DURATION}s ease`,
              `opacity ${CELL_FILL_DURATION}s ease`,
              `top ${CELL_FILL_DURATION}s ease`,
              `width ${CELL_FILL_DURATION}s ease`
            ].join(', '),
        transitionDelay: fading ? `${cell.fadeDelayMs}ms` : '0ms',
        width: grid.pitch
      }
    : {
        animationDelay: `${cell.blinkDelayMs}ms`,
        animationDirection: 'normal',
        animationDuration: `${BLINK_DURATION_MS}ms`,
        animationFillMode: 'both',
        animationIterationCount: 'infinite',
        animationName: reduceMotion ? 'none' : 'painting-skeleton-cell-blink',
        animationTimingFunction: 'ease-in-out',
        backgroundColor: 'var(--muted-foreground)',
        borderRadius: grid.radius,
        height: grid.cellSize,
        left: cell.x,
        opacity: reduceMotion ? 0.24 : cell.initialOpacity,
        position: 'absolute',
        top: cell.y,
        width: grid.cellSize
      }

  return (
    <div
      data-phase={ready ? (fading ? 'fading' : 'coloring') : 'loading'}
      data-slot="painting-skeleton-grid-cell"
      style={style}
    />
  )
})

const PaintingSkeletonSurface: FC<{ imageUrl?: string; onRevealReady?: () => void }> = ({
  imageUrl,
  onRevealReady
}) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const didHandOffRef = useRef(false)
  const reduceMotion = Boolean(useReducedMotion())
  const [grid, setGrid] = useState<Grid | null>(null)
  const [sampledColors, setSampledColors] = useState<SampledColors | null>(null)
  const [fadingKey, setFadingKey] = useState<string | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const measure = () => {
      const { height, width } = root.getBoundingClientRect()
      if (height <= 0 || width <= 0) return

      const next = createGrid(width, height)
      setGrid((current) => (current?.layoutKey === next.layoutKey ? current : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const cells = useMemo<GridCell[]>(() => {
    if (!grid) return []

    return Array.from({ length: grid.cols * grid.rows }, (_, index) => {
      const column = index % grid.cols
      const row = Math.floor(index / grid.cols)
      return {
        blinkDelayMs: Math.round(cellNoise(index, 1) * BLINK_DURATION_MS),
        fadeDelayMs: Math.round(cellNoise(index, 2) * CELL_FADE_DELAY_MAX_MS),
        id: `${row}-${column}`,
        initialOpacity: 0.16 + cellNoise(index, 3) * 0.36,
        x: grid.offsetX + column * grid.pitch,
        y: grid.offsetY + row * grid.pitch
      }
    })
  }, [grid])

  const sampleCols = grid?.cols
  const sampleRows = grid?.rows
  const sampleKey = imageUrl && sampleCols && sampleRows ? `${imageUrl}\u0000${sampleCols}x${sampleRows}` : null
  const colorsReady = Boolean(sampleKey && sampledColors?.key === sampleKey)
  const fading = Boolean(sampleKey && fadingKey === sampleKey)

  useEffect(() => {
    if (!imageUrl || !sampleCols || !sampleRows || !sampleKey || reduceMotion) return

    let active = true
    void downsampleCellColors(imageUrl, { cols: sampleCols, rows: sampleRows }).then((colors) => {
      if (active) {
        setSampledColors({ colors: colors ?? [], key: sampleKey })
      }
    })
    return () => {
      active = false
    }
  }, [imageUrl, reduceMotion, sampleCols, sampleKey, sampleRows])

  useEffect(() => {
    if (!colorsReady || !sampleKey || reduceMotion) return

    const timer = setTimeout(() => setFadingKey(sampleKey), CELL_FILL_DURATION * 1000)
    return () => clearTimeout(timer)
  }, [colorsReady, reduceMotion, sampleKey])

  useEffect(() => {
    didHandOffRef.current = false
  }, [imageUrl])

  const handOffReveal = useCallback(() => {
    if (didHandOffRef.current || !onRevealReady) return
    didHandOffRef.current = true
    onRevealReady()
  }, [onRevealReady])

  useEffect(() => {
    if (imageUrl && reduceMotion) {
      handOffReveal()
    }
  }, [handOffReveal, imageUrl, reduceMotion])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="relative h-full w-full overflow-hidden bg-background"
      data-slot="painting-skeleton-surface">
      <style>{`
        @keyframes painting-skeleton-cell-blink {
          0%, 100% { opacity: 0.16; }
          50% { opacity: 0.62; }
        }
      `}</style>

      {grid && !(imageUrl && reduceMotion) && (
        <div
          key={`${grid.cols}x${grid.rows}`}
          className="pointer-events-none absolute inset-0 z-10"
          data-slot="painting-skeleton-grid">
          {cells.map((cell, index) => (
            <Cell
              key={cell.id}
              cell={cell}
              color={colorsReady ? sampledColors?.colors[index] : undefined}
              fading={fading}
              grid={grid}
              ready={colorsReady}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>
      )}

      {imageUrl &&
        (reduceMotion ? (
          <img
            src={imageUrl}
            alt=""
            className="pointer-events-none absolute inset-0 size-full object-cover"
            data-slot="painting-skeleton-reveal"
            draggable={false}
          />
        ) : (
          colorsReady && (
            <motion.img
              key={sampleKey}
              src={imageUrl}
              alt=""
              className="pointer-events-none absolute inset-0 size-full object-cover"
              data-slot="painting-skeleton-reveal"
              draggable={false}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: CELL_FILL_DURATION, duration: IMAGE_REVEAL_DURATION, ease: 'easeOut' }}
              onAnimationComplete={handOffReveal}
            />
          )
        ))}
    </div>
  )
}

export default PaintingSkeletonSurface
