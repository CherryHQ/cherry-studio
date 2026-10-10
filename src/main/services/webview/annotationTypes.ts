import type { AccessibilityContext } from '@main/features/browser'
import type { WebviewAnnotation, WebviewAnnotationTarget } from '@shared/types/webviewAnnotation'

export type {
  AccessibilityContext,
  AccessibilityState,
  AccessibleNode,
  AccessibleNodeSummary
} from '@main/features/browser'

export interface AnnotationPage {
  title: string
  url: string
}

export interface AnnotationDocument {
  target: WebviewAnnotationTarget
  page: AnnotationPage
  annotations: WebviewAnnotation[]
}

export interface ResolvedAnnotation extends WebviewAnnotation {
  accessibility: AccessibilityContext
}

export interface ResolvedAnnotationDocument extends Omit<AnnotationDocument, 'annotations'> {
  annotations: ResolvedAnnotation[]
}
