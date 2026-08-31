/**
 * Constants shared by more than one overlay component, or expressing a decision
 * that spans components. Component-local geometry (magnifier grid, handle sizes,
 * toolbar gaps) stays with its component.
 *
 * Every value here is in LOGICAL (CSS) pixels except {@link BORDER_WIDTH}.
 */

/** Selection border and window-highlight border. */
export const ACCENT_COLOR = 'rgba(32, 128, 255, 0.9)'

/** Dimming laid over everything outside the selection. */
export const MASK_COLOR = 'rgba(0, 0, 0, 0.45)'

/**
 * Selection border width in PHYSICAL pixels — the one exception in this file.
 * Consumers divide by `scaleFactor` before drawing into an already-scaled context
 * (or multiply by the magnifier's zoom), so the border is exactly 3 device pixels
 * on any display instead of getting fatter with the scale factor.
 */
export const BORDER_WIDTH = 3

/** Annotation palette offered by the property panel. */
export const ANNOTATION_COLORS = [
  '#F54A45', // Red
  '#FFC60A', // Yellow
  '#35BD4B', // Green
  '#336DF4', // Blue
  '#000000', // Black
  '#8F959E', // Gray
  '#FFFFFF' // White
] as const

/**
 * Stroke widths offered by the property panel. Also the key set of the arrow
 * geometry table in `utils/drawAnnotation.ts` — adding one here without a matching
 * entry there silently falls back to the middle arrow proportions.
 */
export const STROKE_WIDTH_PRESETS = [2, 4, 6] as const

/**
 * Text sizes offered by the property panel. Used as both the textarea's CSS
 * `fontSize` and the canvas `ctx.font` size, which only agree in logical space.
 */
export const FONT_SIZE_PRESETS = [14, 20, 28] as const

/** Mosaic block edge. The block grid is laid out in selection-local logical coords; only the pixel sampling index scales. */
export const MOSAIC_BLOCK_SIZE = 8

/** Property-panel height estimate. The toolbar reserves this much when deciding whether to flip above the selection. */
export const PROPERTY_PANEL_HEIGHT = 38

/**
 * Stacking order for the whole overlay — one table because these layers are only
 * meaningful relative to each other. Corner handles deliberately beat the edge
 * strips so corners win where they overlap; the text editor beats everything so a
 * click never lands on the layer underneath it.
 */
export const Z_INDEX = {
  CAPTURE_CANVAS: 0,
  ANNOTATION_CANVAS: 2,
  HANDLE_EDGE: 4,
  HANDLE_CORNER: 5,
  OCR_OVERLAY: 10,
  MAGNIFIER: 15,
  DIMENSION_LABEL: 20,
  TOOLBAR: 20,
  PROPERTY_PANEL: 20,
  TEXT_INPUT: 30
} as const
