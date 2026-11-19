// Adapted from T3 Code, copyright (c) 2026 T3 Tools Inc. (MIT).
// Provenance and license: resources/terminal/ghostty/README.md.

import { GHOSTTY_CELL_WIDE, type GhosttyCell, type GhosttyColor, type GhosttySnapshot } from '@shared/types/terminal'

function ghosttyColorsEqual(a: GhosttyColor, b: GhosttyColor): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

export interface GhosttyCellMetrics {
  readonly width: number
  readonly height: number
  readonly baseline: number
}

export interface GhosttyCellRange {
  readonly start: { readonly x: number; readonly y: number }
  readonly end: { readonly x: number; readonly y: number }
}

const DEFAULT_SELECTION_BACKGROUND = 'rgba(72, 122, 191, 0.35)'
const POWERLINE_SOLID_RIGHT = '\ue0b0'
const POWERLINE_SOLID_LEFT = '\ue0b2'
const POWERLINE_ROUND_RIGHT = '\ue0b4'
const POWERLINE_ROUND_LEFT = '\ue0b6'

function cssColor(color: GhosttyColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`
}

function sameTextStyle(left: GhosttyCell, right: GhosttyCell): boolean {
  // Selection only tints the background; splitting text runs shifts glyph spacing when advances differ from cell width.
  return (
    ghosttyColorsEqual(left.foreground, right.foreground) &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.invisible === right.invisible
  )
}

function isSolidPowerlineSeparator(text: string): boolean {
  return (
    text === POWERLINE_SOLID_RIGHT ||
    text === POWERLINE_SOLID_LEFT ||
    text === POWERLINE_ROUND_RIGHT ||
    text === POWERLINE_ROUND_LEFT
  )
}

// Fallback fonts inset or scale these private-use glyphs, leaving a gap where
// the separator should meet the next cell. Fill the triangle or half-ellipse
// from the cell's own edges instead, as native terminals do.
function fillSolidPowerlineSeparator(
  context: CanvasRenderingContext2D,
  text: string,
  left: number,
  top: number,
  width: number,
  height: number,
  seamOverlap: number
): void {
  const right = left + width
  const middle = top + height / 2
  if (text === POWERLINE_ROUND_RIGHT || text === POWERLINE_ROUND_LEFT) {
    const [base, start, inward] = text === POWERLINE_ROUND_RIGHT ? [left, -Math.PI / 2, -1] : [right, Math.PI / 2, 1]
    context.beginPath()
    context.ellipse(base, middle, width, height / 2, 0, start, start + Math.PI)
    context.closePath()
    // Overlap the segment this cap closes so anti-aliasing at a fractional
    // cell edge does not leave a hairline seam.
    context.rect(Math.min(base, base + inward * seamOverlap), top, seamOverlap, height)
    context.fill()
    return
  }
  const [base, point] = text === POWERLINE_SOLID_RIGHT ? [left, right] : [right, left]
  context.beginPath()
  context.moveTo(base, top)
  context.lineTo(point, middle)
  context.lineTo(base, top + height)
  context.closePath()
  context.fill()
}

function ghosttyTextRunEnd(
  cells: readonly GhosttyCell[],
  start: number,
  sameStyle: (cell: GhosttyCell) => boolean
): number {
  let end = start + 1
  while (end < cells.length) {
    const next = cells[end]
    if (!next) break
    if (next.wide === GHOSTTY_CELL_WIDE.spacerTail) {
      end += 1
      continue
    }
    if (next.text.length === 0 || isSolidPowerlineSeparator(next.text) || !sameStyle(next)) break
    end += 1
  }
  return end
}

// Snapshots decode `wide` only for empty cells, so a wide glyph is known by its spacer tail.
function isWideGlyph(cells: readonly GhosttyCell[], index: number): boolean {
  return cells[index + 1]?.wide === GHOSTTY_CELL_WIDE.spacerTail
}

// Wide glyphs rarely advance exactly two cells, so each is centred in its own box
// and the narrow text after it restarts at its own column instead of drifting.
function fillGhosttyRunText(
  context: CanvasRenderingContext2D,
  cells: readonly GhosttyCell[],
  start: number,
  end: number,
  text: string,
  left: number,
  baseline: number,
  cellWidth: number
): void {
  let segment = start
  while (segment < end) {
    let segmentEnd = segment
    while (segmentEnd < end && !isWideGlyph(cells, segmentEnd)) segmentEnd += 1
    if (segmentEnd > segment) {
      const segmentText =
        segment === start && segmentEnd === end
          ? text
          : cells
              .slice(segment, segmentEnd)
              .map((cell) => cell.text)
              .join('')
      context.fillText(segmentText, left + (segment - start) * cellWidth, baseline, (segmentEnd - segment) * cellWidth)
    }
    if (segmentEnd === end) break
    context.textAlign = 'center'
    context.fillText(
      cells[segmentEnd]?.text ?? '',
      left + (segmentEnd - start + 1) * cellWidth,
      baseline,
      cellWidth * 2
    )
    context.textAlign = 'start'
    segment = segmentEnd + 2
  }
}

function fontForCell(cell: GhosttyCell, fontSize: number, fontFamily: string): string {
  const style = cell.italic ? 'italic' : 'normal'
  const weight = cell.bold ? '700' : '400'
  return `${style} ${weight} ${fontSize}px ${fontFamily}`
}

export function measureGhosttyCell(
  context: CanvasRenderingContext2D,
  fontSize: number,
  fontFamily: string
): GhosttyCellMetrics {
  context.font = `normal 400 ${fontSize}px ${fontFamily}`
  const widthMeasurement = context.measureText('M')
  const verticalMeasurement = context.measureText('Mg')
  const ascent = verticalMeasurement.actualBoundingBoxAscent || fontSize
  const descent = verticalMeasurement.actualBoundingBoxDescent
  const glyphHeight = ascent + descent
  const height = Math.max(1, Math.round(fontSize * 1.35), Math.ceil(glyphHeight))
  return {
    width: Math.max(1, widthMeasurement.width),
    height,
    baseline: Math.round((height - glyphHeight) / 2 + ascent)
  }
}

export function terminalGridSize(
  width: number,
  height: number,
  metrics: GhosttyCellMetrics,
  padding: number
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((width - padding * 2) / metrics.width)),
    rows: Math.max(1, Math.floor((height - padding * 2) / metrics.height))
  }
}

export function renderGhosttySnapshot(options: {
  readonly context: CanvasRenderingContext2D
  readonly snapshot: GhosttySnapshot
  readonly metrics: GhosttyCellMetrics
  readonly fontSize: number
  readonly fontFamily: string
  readonly padding: number
  readonly forceFull: boolean
  readonly cursorOn: boolean
  readonly previousCursorY?: number | null
  readonly focused?: boolean
  readonly selectionBackground?: string
  readonly hoveredLinkRange?: GhosttyCellRange | null
  readonly originY?: number
}): void {
  const { context, snapshot, metrics, fontSize, fontFamily, padding, forceFull, previousCursorY } = options
  const selectionBackground = options.selectionBackground ?? DEFAULT_SELECTION_BACKGROUND
  const hoveredLinkRange = options.hoveredLinkRange ?? null
  const originY = options.originY ?? padding
  // Rows start on whole device pixels and clear the full canvas width, so repainting
  // a row replaces every pixel the last frame drew in it, including a cursor's edges.
  const transform = context.getTransform()
  const rowTop = (row: number) => Math.round((originY + row * metrics.height) * transform.d) / transform.d
  const rowWidth = context.canvas.width / transform.a
  const rowsToDraw = forceFull ? Array.from({ length: snapshot.rows }, (_, index) => index) : [...snapshot.dirtyRows]
  if (
    previousCursorY !== null &&
    previousCursorY !== undefined &&
    previousCursorY >= 0 &&
    !rowsToDraw.includes(previousCursorY)
  ) {
    rowsToDraw.push(previousCursorY)
  }
  if (snapshot.cursorVisible && snapshot.cursorY >= 0 && !rowsToDraw.includes(snapshot.cursorY)) {
    rowsToDraw.push(snapshot.cursorY)
  }

  if (forceFull) {
    context.save()
    context.resetTransform()
    context.fillStyle = cssColor(snapshot.background)
    context.fillRect(0, 0, context.canvas.width, context.canvas.height)
    context.restore()
  }

  context.textBaseline = 'alphabetic'
  for (const rowIndex of rowsToDraw) {
    const row = snapshot.rowData[rowIndex]
    if (!row) continue
    const top = rowTop(rowIndex)
    const height = rowTop(rowIndex + 1) - top

    context.fillStyle = cssColor(snapshot.background)
    context.fillRect(0, top, rowWidth, height)

    let backgroundStart = 0
    while (backgroundStart < row.cells.length) {
      const first = row.cells[backgroundStart]
      if (!first) break
      let backgroundEnd = backgroundStart + 1
      while (backgroundEnd < row.cells.length) {
        const next = row.cells[backgroundEnd]
        if (!next || next.selected !== first.selected || !ghosttyColorsEqual(next.background, first.background)) {
          break
        }
        backgroundEnd += 1
      }
      if (first.selected || !ghosttyColorsEqual(first.background, snapshot.background)) {
        const left = padding + backgroundStart * metrics.width
        const width = (backgroundEnd - backgroundStart) * metrics.width
        if (!ghosttyColorsEqual(first.background, snapshot.background)) {
          context.fillStyle = cssColor(first.background)
          context.fillRect(left, top, width, height)
        }
        if (first.selected) {
          context.fillStyle = selectionBackground
          context.fillRect(left, top, width, height)
        }
      }
      backgroundStart = backgroundEnd
    }

    let runStart = 0
    while (runStart < row.cells.length) {
      const first = row.cells[runStart]
      if (!first) break
      if (first.text.length === 0) {
        runStart += 1
        continue
      }
      if (isSolidPowerlineSeparator(first.text)) {
        if (!first.invisible) {
          context.fillStyle = cssColor(first.foreground)
          fillSolidPowerlineSeparator(
            context,
            first.text,
            padding + runStart * metrics.width,
            top,
            metrics.width,
            height,
            1
          )
        }
        runStart += 1
        continue
      }
      const runEnd = ghosttyTextRunEnd(row.cells, runStart, (cell) => sameTextStyle(cell, first))
      const text = row.cells
        .slice(runStart, runEnd)
        .map((cell) => cell.text)
        .join('')
      if (!first.invisible && text.trim().length > 0) {
        context.save()
        context.beginPath()
        context.rect(padding + runStart * metrics.width, top, (runEnd - runStart) * metrics.width, height)
        context.clip()
        context.font = fontForCell(first, fontSize, fontFamily)
        context.fillStyle = cssColor(first.foreground)
        fillGhosttyRunText(
          context,
          row.cells,
          runStart,
          runEnd,
          text,
          padding + runStart * metrics.width,
          top + metrics.baseline,
          metrics.width
        )
        context.restore()
      }
      runStart = runEnd
    }

    for (let column = 0; column < row.cells.length; column += 1) {
      const cell = row.cells[column]
      const hoveredLink =
        hoveredLinkRange !== null &&
        rowIndex >= hoveredLinkRange.start.y &&
        rowIndex <= hoveredLinkRange.end.y &&
        (rowIndex > hoveredLinkRange.start.y || column >= hoveredLinkRange.start.x) &&
        (rowIndex < hoveredLinkRange.end.y || column <= hoveredLinkRange.end.x)
      if (!cell || (!cell.underline && !cell.strikethrough && !cell.overline && !hoveredLink)) {
        continue
      }
      context.fillStyle = cssColor(cell.foreground)
      const left = padding + column * metrics.width
      if (cell.underline || hoveredLink) {
        context.fillRect(left, top + metrics.height - 2, metrics.width, 1)
      }
      if (cell.strikethrough) {
        context.fillRect(left, top + Math.floor(metrics.height * 0.55), metrics.width, 1)
      }
      if (cell.overline) context.fillRect(left, top + 1, metrics.width, 1)
    }
  }
}

export function renderGhosttyCursor(options: {
  context: CanvasRenderingContext2D
  snapshot: GhosttySnapshot
  metrics: GhosttyCellMetrics
  fontSize: number
  fontFamily: string
  padding: number
  cursorOn: boolean
  focused: boolean
}): void {
  const { context, snapshot, metrics, fontSize, fontFamily, padding, cursorOn, focused } = options
  const rowTop = (row: number) => padding + row * metrics.height
  if (cursorOn && snapshot.cursorVisible && snapshot.cursorX >= 0 && snapshot.cursorY >= 0) {
    const left = padding + snapshot.cursorX * metrics.width
    const top = rowTop(snapshot.cursorY)
    const height = rowTop(snapshot.cursorY + 1) - top
    const cells = snapshot.rowData[snapshot.cursorY]?.cells ?? []
    const wide = isWideGlyph(cells, snapshot.cursorX)
    const width = wide ? metrics.width * 2 : metrics.width
    context.fillStyle = cssColor(snapshot.cursor)
    if (!focused || snapshot.cursorStyle === 3) {
      context.strokeStyle = cssColor(snapshot.cursor)
      context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1)
    } else if (snapshot.cursorStyle === 0) {
      context.fillRect(left, top, 2, height)
    } else if (snapshot.cursorStyle === 2) {
      context.fillRect(left, top + height - 2, width, 2)
    } else {
      const cell = cells[snapshot.cursorX]
      context.fillRect(left, top, width, height)
      if (cell?.text) {
        context.fillStyle = cssColor(snapshot.background)
        if (isSolidPowerlineSeparator(cell.text)) {
          fillSolidPowerlineSeparator(context, cell.text, left, top, metrics.width, height, 0)
        } else {
          context.font = fontForCell(cell, fontSize, fontFamily)
          context.textAlign = wide ? 'center' : 'start'
          context.fillText(cell.text, wide ? left + metrics.width : left, top + metrics.baseline, width)
          context.textAlign = 'start'
        }
      }
    }
  }
}
