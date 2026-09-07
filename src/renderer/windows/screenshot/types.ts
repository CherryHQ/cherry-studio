/**
 * Geometry, annotation and state-machine types for the screenshot overlay.
 *
 * Unless a member says otherwise every coordinate here is in LOGICAL (CSS) pixels,
 * measured from the top-left of the display this overlay covers.
 */

/** Selection geometry — the canonical rect type across the overlay. */
export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

/** A point in image-absolute logical pixels. */
export interface Point {
  x: number
  y: number
}

// ── Annotations ──────────────────────────────────────────────────

/** Available annotation tool identifiers. */
export type AnnotationTool = 'rect' | 'arrow' | 'brush' | 'text' | 'mosaic'

/** Hollow rectangle with a coloured stroke. */
export interface RectAnnotation {
  type: 'rect'
  color: string
  strokeWidth: number
  rect: SelectionRect
}

/** Tapered shaft fused with a pointed head, drawn as one filled polygon. */
export interface ArrowAnnotation {
  type: 'arrow'
  color: string
  strokeWidth: number
  start: Point
  end: Point
}

/** Freehand polyline through every collected pointer sample. */
export interface BrushAnnotation {
  type: 'brush'
  color: string
  strokeWidth: number
  points: Point[]
}

/** Text rendered at a position, wrapped to {@link TextAnnotation.maxWidth}. */
export interface TextAnnotation {
  type: 'text'
  color: string
  fontSize: number
  position: Point
  content: string
  /** Wrap width — distance from `position` to the selection's right edge at commit time. */
  maxWidth?: number
}

/** Pixelated brush strokes over the original image. Has no colour by design: mosaic always samples the capture. */
export interface MosaicAnnotation {
  type: 'mosaic'
  strokeWidth: number
  points: Point[]
}

export type Annotation = RectAnnotation | ArrowAnnotation | BrushAnnotation | TextAnnotation | MosaicAnnotation

// ── State machine ────────────────────────────────────────────────

/** Phase of the overlay state machine. */
export type OverlayPhase = 'idle' | 'selecting' | 'selected' | 'moving' | 'resizing'

/** One of the 8 resize handles on the selection border. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface OverlayState {
  phase: OverlayPhase
  /** Current selection rect, null while idle. */
  selection: SelectionRect | null
  /** Where the current drag started. */
  dragOrigin: Point | null
  /** Selection snapshot taken at drag start, so move/resize deltas never accumulate rounding error. */
  selectionAtDragStart: SelectionRect | null
  /** Which resize handle is being dragged. */
  activeHandle: ResizeHandle | null
  /** Current pointer position — always the raw one, so the magnifier follows the cursor past the display edge. */
  pointerPosition: Point | null
}

/**
 * Actions dispatched to {@link overlayReducer}.
 * All x/y are canvas-relative logical pixels.
 */
export type OverlayAction =
  | { type: 'POINTER_DOWN_BACKGROUND'; x: number; y: number }
  | { type: 'POINTER_DOWN_SELECTION'; x: number; y: number }
  | { type: 'POINTER_DOWN_HANDLE'; x: number; y: number; handle: ResizeHandle }
  | { type: 'POINTER_DOWN_WINDOW'; x: number; y: number; windowRect: SelectionRect }
  | { type: 'POINTER_MOVE'; x: number; y: number; viewportWidth?: number; viewportHeight?: number }
  | { type: 'POINTER_UP' }
  | { type: 'RESET' }
