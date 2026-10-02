/**
 * Style panel for the active annotation tool: colour swatches plus stroke widths
 * (or text sizes for the text tool).
 *
 * Sits on the far side of the toolbar from the selection, flipping to the other side
 * only when that would clip off-screen.
 */

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ANNOTATION_COLORS,
  FONT_SIZE_PRESETS,
  PROPERTY_PANEL_HEIGHT,
  STROKE_WIDTH_PRESETS,
  Z_INDEX
} from '../constants'
import type { AnnotationTool } from '../types'

interface PropertyPanelProps {
  toolbarTop: number
  toolbarHeight: number
  /** The toolbar's measured left edge; the panel is left-aligned to it. */
  toolbarLeft: number
  toolbarBelow: boolean
  logicalHeight: number
  activeTool: AnnotationTool
  color: string
  strokeWidth: number
  fontSize: number
  onColorChange: (color: string) => void
  onStrokeWidthChange: (width: number) => void
  onFontSizeChange: (size: number) => void
}

/** Gap between the toolbar and this panel, in CSS px. */
const GAP = 4

// A hex value is no name to anyone listening to it. Keyed by the constant's own members,
// so adding a swatch fails typecheck until it is named here.
const COLOR_LABEL_KEYS: Record<(typeof ANNOTATION_COLORS)[number], string> = {
  '#F54A45': 'screenshot.property.color.red',
  '#FFC60A': 'screenshot.property.color.yellow',
  '#35BD4B': 'screenshot.property.color.green',
  '#336DF4': 'screenshot.property.color.blue',
  '#000000': 'screenshot.property.color.black',
  '#8F959E': 'screenshot.property.color.gray',
  '#FFFFFF': 'screenshot.property.color.white'
}

export const PropertyPanel = memo(function PropertyPanel({
  toolbarTop,
  toolbarHeight,
  toolbarLeft,
  toolbarBelow,
  logicalHeight,
  activeTool,
  color,
  strokeWidth,
  fontSize,
  onColorChange,
  onStrokeWidthChange,
  onFontSizeChange
}: PropertyPanelProps) {
  const { t } = useTranslation()
  const isTextTool = activeTool === 'text'
  const isMosaicTool = activeTool === 'mosaic'

  let top: number
  if (toolbarBelow) {
    const belowTop = toolbarTop + toolbarHeight + GAP
    // No room left below → flip above the toolbar, accepting that it covers part of
    // the selection; being off-screen would be worse.
    top = belowTop + PROPERTY_PANEL_HEIGHT <= logicalHeight ? belowTop : toolbarTop - PROPERTY_PANEL_HEIGHT - GAP
  } else {
    const aboveTop = toolbarTop - PROPERTY_PANEL_HEIGHT - GAP
    top = aboveTop >= 0 ? aboveTop : toolbarTop + toolbarHeight + GAP
  }

  return (
    <div
      className="absolute flex items-center gap-0.5 rounded-lg border border-border bg-popover/85 p-0.5 shadow-md backdrop-blur-xs"
      style={{
        zIndex: Z_INDEX.PROPERTY_PANEL,
        top,
        left: toolbarLeft
      }}
      // stopPropagation keeps the canvas below from starting a new selection.
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
      // preventDefault on mousedown suppresses the focus change, so restyling mid-typing
      // does not blur the text editor and commit the annotation the user is still writing.
      onMouseDown={(e: ReactMouseEvent) => e.preventDefault()}>
      {/* No colours for mosaic — it always paints the capture's own pixels. */}
      {!isMosaicTool && (
        <>
          <div className="flex items-center">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t(COLOR_LABEL_KEYS[c])}
                aria-pressed={c === color}
                className="flex size-8 items-center justify-center rounded"
                onClick={() => onColorChange(c)}>
                <div
                  className="size-4 rounded-full border border-border/50 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    boxShadow: c === color ? `0 0 0 1.5px ${c}, 0 0 0 3px rgba(255,255,255,0.8)` : undefined
                  }}
                />
              </button>
            ))}
          </div>
          <div className="mx-0.5 h-4 w-px bg-muted-foreground/20" />
        </>
      )}

      {isTextTool ? (
        <div className="flex items-center gap-0.5">
          {FONT_SIZE_PRESETS.map((size, i) => (
            <button
              key={size}
              type="button"
              // All three read "A", so the size itself has to carry the name.
              aria-label={t('screenshot.property.font_size', { value: size })}
              aria-pressed={fontSize === size}
              className="flex size-8 items-center justify-center rounded text-popover-foreground transition-colors hover:bg-accent"
              style={{
                // The glyph scales with the preset index rather than the preset value,
                // so all three fit the 32 px control.
                fontSize: 10 + i * 4,
                fontWeight: fontSize === size ? 700 : 400,
                opacity: fontSize === size ? 1 : 0.5
              }}
              onClick={() => onFontSizeChange(size)}>
              A
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          {STROKE_WIDTH_PRESETS.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={t('screenshot.property.stroke_width', { value: w })}
              aria-pressed={strokeWidth === w}
              className="flex size-8 items-center justify-center rounded transition-colors hover:bg-accent"
              style={{ opacity: strokeWidth === w ? 1 : 0.4 }}
              onClick={() => onStrokeWidthChange(w)}>
              <div className="rounded-full bg-popover-foreground" style={{ width: w * 2 + 4, height: w + 1 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
