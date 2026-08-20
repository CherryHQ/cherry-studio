import type { Annotation, AnnotationTool, Point } from '../types'

/**
 * Build an annotation from live drawing state.
 *
 * Coordinates are whatever the caller passes, which in practice is image-absolute
 * logical pixels — that is what lets annotations survive a selection move.
 */
export function buildAnnotation(
  tool: AnnotationTool,
  start: Point,
  end: Point,
  points: Point[],
  color: string,
  strokeWidth: number
): Annotation | null {
  switch (tool) {
    case 'rect': {
      const x = Math.min(start.x, end.x)
      const y = Math.min(start.y, end.y)
      const width = Math.abs(end.x - start.x)
      const height = Math.abs(end.y - start.y)
      return { type: 'rect', color, strokeWidth, rect: { x, y, width, height } }
    }
    case 'arrow':
      return { type: 'arrow', color, strokeWidth, start, end }
    case 'brush':
      // Copied: the caller keeps pushing into the live array after this returns.
      return { type: 'brush', color, strokeWidth, points: [...points] }
    case 'mosaic':
      return { type: 'mosaic', strokeWidth, points: [...points] }
    case 'text':
      // Text comes from the floating textarea, not from pointer drags.
      return null
  }
}

/** Reject click-noise so a stray tap does not pile a dot onto the undo stack and into the export. */
export function isSignificantAnnotation(annotation: Annotation): boolean {
  switch (annotation.type) {
    case 'rect':
      return annotation.rect.width > 2 && annotation.rect.height > 2
    case 'arrow': {
      const dx = annotation.end.x - annotation.start.x
      const dy = annotation.end.y - annotation.start.y
      return Math.sqrt(dx * dx + dy * dy) > 3
    }
    case 'brush':
    case 'mosaic':
      return annotation.points.length >= 2
    case 'text':
      return annotation.content.length > 0
  }
}
