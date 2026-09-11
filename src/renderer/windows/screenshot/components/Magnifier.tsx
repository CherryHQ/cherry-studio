/**
 * Pixel-grid loupe and colour picker that follows the cursor.
 *
 * Each physical pixel becomes one visible cell with grid lines; the centre cell is
 * the pixel under the focus point and carries a contrasting double border.
 *
 * Shortcuts while visible: Shift toggles HEX / RGB, C copies the current value.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import { usePersistCache } from '@data/hooks/useCache'

import { ACCENT_COLOR, BORDER_WIDTH, Z_INDEX } from '../constants'
import type { SelectionRect } from '../types'

/** Loupe size in CSS px; the backing store is this times the scale factor. */
const MAG_WIDTH = 160
const MAG_HEIGHT = 100
/** Requested cell size in CSS px per source pixel, before rounding to whole device pixels. */
const CELL_SIZE = 11
/** Distance from the cursor in CSS px. */
const OFFSET_X = 12
const OFFSET_Y = 12
/** Coordinate + colour bar height in CSS px. Two 16px lines plus breathing room. */
const INFO_HEIGHT = 46
/** Shortcut hint bar height in CSS px — three 14px lines plus breathing room. */
const HINT_HEIGHT = 54
/** How long the "copied" acknowledgement replaces the colour text, in ms. */
const COPIED_RESET_MS = 1000

interface MagnifierProps {
  image: HTMLImageElement
  cursorX: number
  cursorY: number
  /** Grid centre; defaults to the cursor. The grid centres on focus, the panel positions on the cursor. */
  focusX?: number
  focusY?: number
  scaleFactor: number
  logicalWidth: number
  logicalHeight: number
  visible: boolean
  showHints?: boolean
  /** When set, the selection border is drawn into the grid at the same magnification. */
  selection?: SelectionRect | null
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`
}

export const Magnifier = memo(function Magnifier({
  image,
  cursorX,
  cursorY,
  focusX: focusXProp,
  focusY: focusYProp,
  scaleFactor,
  logicalWidth,
  logicalHeight,
  visible,
  showHints = true,
  selection
}: MagnifierProps) {
  const { t } = useTranslation()
  const focusX = focusXProp ?? cursorX
  const focusY = focusYProp ?? cursorY
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pixelRgb, setPixelRgb] = useState<[number, number, number]>([0, 0, 0])
  const [colorMode, setColorMode] = usePersistCache('ui.screenshot.color_mode')
  const [copied, setCopied] = useState(false)

  const colorText = colorMode === 'hex' ? rgbToHex(...pixelRgb) : `RGB(${pixelRgb.join(', ')})`

  // Written during render so the hotkey callback never copies a stale colour.
  const colorTextRef = useRef(colorText)
  colorTextRef.current = colorText

  useHotkeys(
    'shift',
    (e) => {
      // Holding Shift auto-repeats, which would strobe the readout.
      if (e.repeat) return
      setColorMode((prev) => (prev === 'rgb' ? 'hex' : 'rgb'))
    },
    { enabled: visible }
  )

  useHotkeys(
    'c',
    () => {
      void navigator.clipboard.writeText(colorTextRef.current)
      setCopied(true)
    },
    { enabled: visible }
  )

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const gridParams = useMemo(() => {
    // Physical canvas pixels per source pixel. Rounded, so a fractional scale factor
    // yields a slightly different effective zoom rather than blurry half-cells.
    const zoom = Math.round(CELL_SIZE * scaleFactor)
    const physMagW = MAG_WIDTH * scaleFactor
    const physMagH = MAG_HEIGHT * scaleFactor
    // Forced odd: only an odd count has an exact centre cell for the picker to read.
    let cols = Math.ceil(physMagW / zoom)
    if (cols % 2 === 0) cols++
    let rows = Math.ceil(physMagH / zoom)
    if (rows % 2 === 0) rows++
    const halfCols = Math.floor(cols / 2)
    const halfRows = Math.floor(rows / 2)
    const offsetX = Math.round((physMagW - cols * zoom) / 2)
    const offsetY = Math.round((physMagH - rows * zoom) / 2)
    const centerPhysX = Math.floor(focusX * scaleFactor)
    const centerPhysY = Math.floor(focusY * scaleFactor)
    return {
      zoom,
      physMagW,
      physMagH,
      cols,
      rows,
      halfCols,
      halfRows,
      offsetX,
      offsetY,
      srcX: centerPhysX - halfCols,
      srcY: centerPhysY - halfRows
    }
  }, [focusX, focusY, scaleFactor])

  useLayoutEffect(() => {
    if (!visible) return

    const canvas = canvasRef.current
    if (!canvas) return
    // willReadFrequently: the centre pixel is read every pointer move, and without it
    // each read forces a GPU→CPU readback.
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const { zoom, physMagW, physMagH, cols, rows, halfCols, halfRows, offsetX, offsetY, srcX, srcY } = gridParams

    canvas.width = physMagW
    canvas.height = physMagH

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, physMagW, physMagH)

    // Nearest-neighbour: a bilinear upscale would blur the grid and make the picker
    // read an interpolated colour that exists nowhere on screen.
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, srcX, srcY, cols, rows, offsetX, offsetY, cols * zoom, rows * zoom)

    // Read BEFORE any overlay is painted, or the picker reports the crosshair tint.
    const centerCanvasX = offsetX + halfCols * zoom + Math.floor(zoom / 2)
    const centerCanvasY = offsetY + halfRows * zoom + Math.floor(zoom / 2)
    const pixel = ctx.getImageData(centerCanvasX, centerCanvasY, 1, 1).data

    // Crosshair as four rects rather than two full-length ones: the centre cell must
    // stay untinted so the user sees the true colour of the pixel being picked.
    ctx.fillStyle = 'rgba(0, 120, 215, 0.25)'
    ctx.fillRect(offsetX + halfCols * zoom, offsetY, zoom, halfRows * zoom)
    ctx.fillRect(offsetX + halfCols * zoom, offsetY + (halfRows + 1) * zoom, zoom, (rows - halfRows - 1) * zoom)
    ctx.fillRect(offsetX, offsetY + halfRows * zoom, halfCols * zoom, zoom)
    ctx.fillRect(offsetX + (halfCols + 1) * zoom, offsetY + halfRows * zoom, (cols - halfCols - 1) * zoom, zoom)

    if (selection && selection.width > 0 && selection.height > 0) {
      // BORDER_WIDTH is physical and zoom is canvas px per physical px, so the border
      // magnifies with the grid instead of staying a hairline.
      const bwMag = BORDER_WIDTH * zoom
      const selLeft = Math.round(selection.x * scaleFactor)
      const selTop = Math.round(selection.y * scaleFactor)
      const selX = offsetX + (selLeft - srcX) * zoom
      const selY = offsetY + (selTop - srcY) * zoom
      const selW = (Math.round((selection.x + selection.width) * scaleFactor) - selLeft) * zoom
      const selH = (Math.round((selection.y + selection.height) * scaleFactor) - selTop) * zoom
      ctx.fillStyle = ACCENT_COLOR
      ctx.fillRect(selX - bwMag, selY - bwMag, selW + 2 * bwMag, bwMag)
      ctx.fillRect(selX - bwMag, selY + selH, selW + 2 * bwMag, bwMag)
      ctx.fillRect(selX - bwMag, selY, bwMag, selH)
      ctx.fillRect(selX + selW, selY, bwMag, selH)
    }

    // Grid lines. The +0.5 puts each 1 px stroke on a pixel centre; on a boundary it
    // would render as two half-opacity rows and the whole grid would look fuzzy.
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.1)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= cols; i++) {
      const x = offsetX + i * zoom + 0.5
      ctx.moveTo(x, offsetY)
      ctx.lineTo(x, offsetY + rows * zoom)
    }
    for (let i = 0; i <= rows; i++) {
      const y = offsetY + i * zoom + 0.5
      ctx.moveTo(offsetX, y)
      ctx.lineTo(offsetX + cols * zoom, y)
    }
    ctx.stroke()

    // Centre cell: dark halo then bright inner, so it reads on any background.
    const cpX = offsetX + halfCols * zoom
    const cpY = offsetY + halfRows * zoom
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.lineWidth = 3
    ctx.strokeRect(cpX + 0.5, cpY + 0.5, zoom - 1, zoom - 1)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(cpX + 0.5, cpY + 0.5, zoom - 1, zoom - 1)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
    ctx.lineWidth = 2
    ctx.strokeRect(0, 0, physMagW, physMagH)

    setPixelRgb([pixel[0], pixel[1], pixel[2]])
  }, [visible, image, gridParams, selection, scaleFactor])

  if (!visible) return null

  const totalHeight = MAG_HEIGHT + INFO_HEIGHT + (showHints ? HINT_HEIGHT : 0)
  const flipX = cursorX + OFFSET_X + MAG_WIDTH > logicalWidth
  const flipY = cursorY + OFFSET_Y + totalHeight > logicalHeight

  const left = flipX ? cursorX - OFFSET_X - MAG_WIDTH : cursorX + OFFSET_X
  const top = flipY ? cursorY - OFFSET_Y - totalHeight : cursorY + OFFSET_Y

  // Focus, not cursor: this is the pixel whose colour is shown above.
  const physX = Math.round(focusX * scaleFactor)
  const physY = Math.round(focusY * scaleFactor)

  const hexColor = rgbToHex(...pixelRgb)

  return (
    <div className="pointer-events-none absolute" style={{ zIndex: Z_INDEX.MAGNIFIER, left, top }}>
      <canvas ref={canvasRef} style={{ width: MAG_WIDTH, height: MAG_HEIGHT, display: 'block' }} />
      <div
        // text-xs, not text-sm: the RGB form is more than twice the width of the hex one
        // and overflowed the loupe at the larger size.
        className="flex flex-col items-center justify-center gap-0.5 whitespace-nowrap bg-black/75 py-1.5 font-mono text-white/90 text-xs"
        style={{ width: MAG_WIDTH, height: INFO_HEIGHT }}>
        <span>
          ({physX}, {physY})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 border border-white/40" style={{ background: hexColor }} />
          {copied ? t('screenshot.magnifier.copied') : colorText}
        </span>
      </div>
      {showHints && (
        <div
          // One hint per line: side by side they exceed the loupe width in every locale,
          // and a flex row lets each hint wrap inside its own cell instead of clipping.
          className="flex flex-col items-center justify-center whitespace-nowrap bg-black/60 py-1.5 font-mono text-[11px] text-white/50 leading-[14px]"
          style={{ width: MAG_WIDTH, height: HINT_HEIGHT }}>
          <span>{t('screenshot.magnifier.hint_move')}</span>
          <span>{t('screenshot.magnifier.hint_color_mode')}</span>
          <span>{t('screenshot.magnifier.hint_copy')}</span>
        </div>
      )}
    </div>
  )
})
