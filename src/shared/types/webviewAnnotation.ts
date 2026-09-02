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
    createdAt: z.number().int().nonnegative(),
    element: WebviewElementLocatorSchema,
    region: WebviewAnnotationRegionSchema.optional()
  })
  .strict()

export const WebviewAnnotationStateSchema = z
  .object({
    enabled: z.boolean(),
    annotations: z.array(WebviewAnnotationSchema).max(WEBVIEW_ANNOTATION_LIMITS.annotations)
  })
  .strict()

export const WebviewAnnotationPageSchema = z
  .object({
    title: z.string().trim().max(WEBVIEW_ANNOTATION_LIMITS.pageTitle),
    url: z.string().max(WEBVIEW_ANNOTATION_LIMITS.pageUrl)
  })
  .strict()

export const WebviewAnnotationDocumentSchema = z
  .object({
    webviewId: z.number().int().positive(),
    target: WebviewAnnotationTargetSchema,
    page: WebviewAnnotationPageSchema,
    annotations: z.array(WebviewAnnotationSchema).min(1).max(WEBVIEW_ANNOTATION_LIMITS.annotations),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()

export const WebviewAccessibilityStatusSchema = z.enum([
  'available',
  'selector_not_found',
  'debugger_unavailable',
  'timeout',
  'capture_failed',
  'budget_exceeded'
])

export const WebviewAccessibilityStateNameSchema = z.enum([
  'disabled',
  'expanded',
  'checked',
  'pressed',
  'selected',
  'required',
  'invalid',
  'readonly'
])

export const WebviewAccessibilityStateSchema = z
  .object({
    name: WebviewAccessibilityStateNameSchema,
    value: z.union([z.boolean(), z.string().trim().max(64)])
  })
  .strict()

export const WebviewAccessibleNodeSummarySchema = z
  .object({
    role: z.string().trim().min(1).max(WEBVIEW_ANNOTATION_LIMITS.role),
    name: z.string().trim().max(WEBVIEW_ANNOTATION_LIMITS.accessibilityText).nullable(),
    description: z.string().trim().max(WEBVIEW_ANNOTATION_LIMITS.accessibilityText).nullable(),
    states: z.array(WebviewAccessibilityStateSchema).max(WEBVIEW_ANNOTATION_LIMITS.accessibilityStates)
  })
  .strict()

export type WebviewAccessibleNodeSummary = z.infer<typeof WebviewAccessibleNodeSummarySchema>
export type WebviewAccessibleNode = WebviewAccessibleNodeSummary & {
  children: WebviewAccessibleNode[]
}

export const WebviewAccessibleNodeSchema: z.ZodType<WebviewAccessibleNode> = z.lazy(() =>
  WebviewAccessibleNodeSummarySchema.extend({
    children: z.array(WebviewAccessibleNodeSchema).max(WEBVIEW_ANNOTATION_LIMITS.accessibilityNodes)
  }).strict()
)

export const WebviewAccessibilityContextSchema = z
  .object({
    status: WebviewAccessibilityStatusSchema,
    path: z.array(WebviewAccessibleNodeSummarySchema).max(WEBVIEW_ANNOTATION_LIMITS.accessibilityPath),
    tree: WebviewAccessibleNodeSchema.nullable(),
    truncated: z.boolean()
  })
  .strict()

export const WebviewResolvedAnnotationSchema = WebviewAnnotationSchema.extend({
  accessibility: WebviewAccessibilityContextSchema
}).strict()

export const WebviewResolvedAnnotationDocumentSchema = WebviewAnnotationDocumentSchema.extend({
  annotations: z.array(WebviewResolvedAnnotationSchema).min(1).max(WEBVIEW_ANNOTATION_LIMITS.annotations)
}).strict()

export const WebviewAnnotationLocaleSchema = z
  .object({
    placeholder: z.string().max(200),
    save: z.string().max(80),
    cancel: z.string().max(80),
    delete: z.string().max(80),
    edit: z.string().max(80),
    elementUnavailable: z.string().max(200)
  })
  .strict()

export const WebviewAnnotationThemeSchema = z.enum(['light', 'dark'])

export const WebviewAnnotationHostCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('configure'),
      locale: WebviewAnnotationLocaleSchema,
      theme: WebviewAnnotationThemeSchema
    })
    .strict(),
  z.object({ type: z.literal('set_enabled'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('clear') }).strict(),
  z.object({ type: z.literal('reset') }).strict(),
  z.object({ type: z.literal('request_state') }).strict()
])

export const WebviewAnnotationGuestEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('state_changed'),
      state: WebviewAnnotationStateSchema
    })
    .strict()
])

export type WebviewAnnotationTarget = z.infer<typeof WebviewAnnotationTargetSchema>
export type WebviewElementLocator = z.infer<typeof WebviewElementLocatorSchema>
export type WebviewRegionRect = z.infer<typeof WebviewRegionRectSchema>
export type WebviewAnnotationRegion = z.infer<typeof WebviewAnnotationRegionSchema>
export type WebviewAnnotation = z.infer<typeof WebviewAnnotationSchema>
export type WebviewAnnotationState = z.infer<typeof WebviewAnnotationStateSchema>
export type WebviewAnnotationDocument = z.infer<typeof WebviewAnnotationDocumentSchema>
export type WebviewAccessibilityStatus = z.infer<typeof WebviewAccessibilityStatusSchema>
export type WebviewAccessibilityState = z.infer<typeof WebviewAccessibilityStateSchema>
export type WebviewAccessibilityContext = z.infer<typeof WebviewAccessibilityContextSchema>
export type WebviewResolvedAnnotation = z.infer<typeof WebviewResolvedAnnotationSchema>
export type WebviewResolvedAnnotationDocument = z.infer<typeof WebviewResolvedAnnotationDocumentSchema>
export type WebviewAnnotationLocale = z.infer<typeof WebviewAnnotationLocaleSchema>
export type WebviewAnnotationTheme = z.infer<typeof WebviewAnnotationThemeSchema>
export type WebviewAnnotationHostCommand = z.infer<typeof WebviewAnnotationHostCommandSchema>
export type WebviewAnnotationGuestEvent = z.infer<typeof WebviewAnnotationGuestEventSchema>
