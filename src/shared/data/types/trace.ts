import * as z from 'zod'

/**
 * Container-level OTel trace id: 32 lowercase hex chars. `deriveRootSpanId` and the trace
 * viewer silently depend on this shape, so validate it at the schema boundary instead of
 * accepting any string.
 */
export const TraceIdSchema = z.string().regex(/^[0-9a-f]{32}$/, 'traceId must be 32 lowercase hex chars')
