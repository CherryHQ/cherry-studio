import * as z from 'zod'

export const WEBVIEW_ANNOTATION_BRIDGE_CHANNEL = 'cherry:webview-annotation'
export const WEBVIEW_SHADOW_SELECTOR_SEPARATOR = ' >>> '

export const WEBVIEW_ANNOTATION_LIMITS = {
  accessibilityDepth: 5,
  accessibilityNodes: 80,
  accessibilityPath: 12,
  accessibilityRequestNodes: 400,
  accessibilityStates: 8,
  accessibilityText: 240,
  annotations: 50,
  ariaLabel: 240,
  comment: 2_000,
  exportMarkdown: 512_000,
  pageTitle: 240,
  pageUrl: 2_048,
  regionCoord: 10_000_000,
  regionElements: 12,
  role: 64,
  selector: 2_048,
  tagName: 64,
  targetId: 160,
  targetLabel: 120,
  text: 240
} as const

export const WebviewAnnotationTargetSchema = z
  .object({
    id: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.targetId),
    label: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.targetLabel)
  })
  .strict()

export const WebviewElementLocatorSchema = z
  .object({
    selector: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.selector),
    tagName: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.tagName),
    text: z.string().trim().max(WEBVIEW_ANNOTATION_LIMITS.text).nullable(),
    ariaLabel: z.string().trim().max(WEBVIEW_ANNOTATION_LIMITS.ariaLabel).nullable(),
    role: z.string().trim().max(WEBVIEW_ANNOTATION_LIMITS.role).nullable()
  })
  .strict()

export const WebviewRegionRectSchema = z
  .object({
    x: z.number().int().min(-WEBVIEW_ANNOTATION_LIMITS.regionCoord).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord),
    y: z.number().int().min(-WEBVIEW_ANNOTATION_LIMITS.regionCoord).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord),
    width: z.number().int().min(1).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord),
    height: z.number().int().min(1).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord)
  })
  .strict()

export const WebviewAnnotationAnchorRectSchema = z
  .object({
    x: z.number().int().min(-WEBVIEW_ANNOTATION_LIMITS.regionCoord).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord),
    y: z.number().int().min(-WEBVIEW_ANNOTATION_LIMITS.regionCoord).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord),
    width: z.number().int().min(1).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord),
    height: z.number().int().min(1).max(WEBVIEW_ANNOTATION_LIMITS.regionCoord)
  })
  .strict()

/**
 * A marquee-selected page region. `rect` is in page coordinates (viewport +
 * scroll at capture); `elements` are the locators contained in the box. The
 * annotation's `element` stays the deepest common ancestor so accessibility
 * resolution works unchanged.
 */
export const WebviewAnnotationRegionSchema = z
  .object({
    rect: WebviewRegionRectSchema,
    elements: z.array(WebviewElementLocatorSchema).max(WEBVIEW_ANNOTATION_LIMITS.regionElements)
  })
  .strict()

export const WebviewAnnotationSchema = z
  .object({
    id: z.uuid(),
    comment: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.comment),
    element: WebviewElementLocatorSchema,
    region: WebviewAnnotationRegionSchema.optional()
  })
  .strict()

export const WebviewAnnotationSnapshotSchema = z
  .array(WebviewAnnotationSchema)
  .max(WEBVIEW_ANNOTATION_LIMITS.annotations)

export const WebviewAnnotationLocaleSchema = z
  .object({
    edit: z.string().max(80)
  })
  .strict()

export const WebviewAnnotationThemeSchema = z.enum(['light', 'dark'])

export const WebviewAnnotationHostCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_session'), sessionId: z.uuid() }).strict(),
  z.object({ type: z.literal('request_state') }).strict(),
  z
    .object({
      type: z.literal('configure'),
      sessionId: z.uuid(),
      locale: WebviewAnnotationLocaleSchema,
      theme: WebviewAnnotationThemeSchema
    })
    .strict(),
  z.object({ type: z.literal('set_enabled'), sessionId: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('deactivate'), sessionId: z.uuid() }).strict(),
  z.object({ type: z.literal('clear'), sessionId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('save_editor'),
      sessionId: z.uuid(),
      requestId: z.uuid(),
      comment: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.comment)
    })
    .strict(),
  z.object({ type: z.literal('cancel_editor'), sessionId: z.uuid(), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal('delete_editor'), sessionId: z.uuid(), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal('request_snapshot'), sessionId: z.uuid(), requestId: z.uuid() }).strict()
])

export const WebviewAnnotationGuestEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('state_changed'),
      sessionId: z.uuid(),
      enabled: z.boolean(),
      count: z.number().int().nonnegative().max(WEBVIEW_ANNOTATION_LIMITS.annotations)
    })
    .strict(),
  z
    .object({
      type: z.literal('snapshot_ready'),
      sessionId: z.uuid(),
      requestId: z.uuid(),
      annotations: WebviewAnnotationSnapshotSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('editor_requested'),
      sessionId: z.uuid(),
      requestId: z.uuid(),
      comment: z.string().max(WEBVIEW_ANNOTATION_LIMITS.comment),
      canDelete: z.boolean(),
      anchor: WebviewAnnotationAnchorRectSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('editor_anchor_changed'),
      sessionId: z.uuid(),
      requestId: z.uuid(),
      anchor: WebviewAnnotationAnchorRectSchema
    })
    .strict(),
  z.object({ type: z.literal('editor_closed'), sessionId: z.uuid(), requestId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal('editor_error'),
      sessionId: z.uuid(),
      requestId: z.uuid(),
      reason: z.literal('element_unavailable')
    })
    .strict()
])

export type WebviewAnnotationTarget = z.infer<typeof WebviewAnnotationTargetSchema>
export type WebviewElementLocator = z.infer<typeof WebviewElementLocatorSchema>
export type WebviewRegionRect = z.infer<typeof WebviewRegionRectSchema>
export type WebviewAnnotationAnchorRect = z.infer<typeof WebviewAnnotationAnchorRectSchema>
export type WebviewAnnotationRegion = z.infer<typeof WebviewAnnotationRegionSchema>
export type WebviewAnnotation = z.infer<typeof WebviewAnnotationSchema>
export type WebviewAnnotationSnapshot = z.infer<typeof WebviewAnnotationSnapshotSchema>
export type WebviewAnnotationLocale = z.infer<typeof WebviewAnnotationLocaleSchema>
export type WebviewAnnotationTheme = z.infer<typeof WebviewAnnotationThemeSchema>
export type WebviewAnnotationHostCommand = z.infer<typeof WebviewAnnotationHostCommandSchema>
export type WebviewAnnotationGuestEvent = z.infer<typeof WebviewAnnotationGuestEventSchema>
