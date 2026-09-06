import { application } from '@application'
import { loggerService } from '@logger'
import {
  type AccessibilityCaptureBudget,
  type AccessibilityStatus,
  ANNOTATION_EXPORT_LIMITS,
  BrowserSessionError,
  createAccessibilityContext,
  type GuestSession
} from '@main/features/browser'
import {
  WEBVIEW_ANNOTATION_LIMITS,
  type WebviewAnnotation,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'

import { formatWebviewAnnotations, sanitizeWebviewAnnotationUrl } from './annotationMarkdown'
import type { AnnotationDocument, ResolvedAnnotation, ResolvedAnnotationDocument } from './annotationTypes'

const logger = loggerService.withContext('annotationExport')
const ACCESSIBILITY_CAPTURE_TIMEOUT_MS = 5_000

async function captureDocumentAccessibility(
  guest: Electron.WebContents,
  document: AnnotationDocument,
  budget: AccessibilityCaptureBudget,
  deadline: number,
  signal?: AbortSignal
): Promise<ResolvedAnnotation[]> {
  const withStatus = (status: AccessibilityStatus) =>
    document.annotations.map((annotation) => ({
      ...annotation,
      accessibility: createAccessibilityContext(status)
    }))
  if (Date.now() >= deadline) return withStatus('timeout')
  if (budget.remaining <= 0) return withStatus('budget_exceeded')
  if (guest.isDestroyed() || guest.isDevToolsOpened()) return withStatus('debugger_unavailable')
  const service = application.get('BrowserSessionService')
  const owner = `annotation:${guest.id}`
  let session: GuestSession
  try {
    session = service.acquire(guest, owner, { ownership: 'borrowed' })
  } catch {
    return withStatus('debugger_unavailable')
  }
  try {
    const resolved: ResolvedAnnotation[] = []
    for (const annotation of document.annotations) {
      try {
        resolved.push({
          ...annotation,
          accessibility: await session.describeElement(annotation, budget, { deadline, signal })
        })
      } catch (error) {
        signal?.throwIfAborted()
        const status =
          error instanceof BrowserSessionError && (error.code === 'timeout' || error.code === 'debugger_unavailable')
            ? error.code
            : 'capture_failed'
        logger.debug('Failed to capture annotation accessibility context', {
          webviewId: guest.id,
          annotationId: annotation.id,
          status
        })
        resolved.push({ ...annotation, accessibility: createAccessibilityContext(status) })
      }
    }
    return resolved
  } finally {
    service.release(guest, owner)
  }
}

interface ExportAnnotationDocumentInput {
  guest: Electron.WebContents
  target: WebviewAnnotationTarget
  annotations: WebviewAnnotation[]
  signal?: AbortSignal
}

export async function exportAnnotationDocument({
  guest,
  target,
  annotations,
  signal
}: ExportAnnotationDocumentInput): Promise<string> {
  signal?.throwIfAborted()
  if (new Set(annotations.map((annotation) => annotation.id)).size !== annotations.length) {
    throw new Error('Annotation ids must be unique')
  }

  const document: AnnotationDocument = {
    target,
    page: {
      title: guest.getTitle().replace(/\s+/g, ' ').trim().slice(0, ANNOTATION_EXPORT_LIMITS.pageTitle),
      url: sanitizeWebviewAnnotationUrl(guest.getURL()).slice(0, ANNOTATION_EXPORT_LIMITS.pageUrl)
    },
    annotations
  }
  const resolvedAnnotations = await captureDocumentAccessibility(
    guest,
    document,
    { remaining: ANNOTATION_EXPORT_LIMITS.accessibilityRequestNodes },
    Date.now() + ACCESSIBILITY_CAPTURE_TIMEOUT_MS,
    signal
  )
  const copyDocument: ResolvedAnnotationDocument = {
    ...document,
    annotations: resolvedAnnotations.map((annotation) => ({
      ...annotation,
      accessibility: { ...annotation.accessibility }
    }))
  }
  let markdown = formatWebviewAnnotations(copyDocument, { includeSafetyNotice: true }).text

  for (
    let annotationIndex = copyDocument.annotations.length - 1;
    markdown.length > WEBVIEW_ANNOTATION_LIMITS.exportMarkdown && annotationIndex >= 0;
    annotationIndex--
  ) {
    const annotation = copyDocument.annotations[annotationIndex]
    if (annotation.accessibility.status !== 'available') continue
    annotation.accessibility = createAccessibilityContext('budget_exceeded')
    markdown = formatWebviewAnnotations(copyDocument, { includeSafetyNotice: true }).text
  }

  return formatWebviewAnnotations(copyDocument, {
    includeSafetyNotice: true,
    maxChars: WEBVIEW_ANNOTATION_LIMITS.exportMarkdown
  }).text
}
