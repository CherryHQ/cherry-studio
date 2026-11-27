import * as z from 'zod'

export const remoteFailureSchema = z.looseObject({
  reason: z.enum([
    'INVALID_CONNECTION_STATE',
    'UPGRADE_REQUIRED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'GRANT_REVOKED',
    'FORBIDDEN',
    'NOT_FOUND',
    'TARGET_UNAVAILABLE',
    'CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'RESET_REQUIRED',
    'CHECKPOINT_EXPIRED',
    'REVISION_EXPIRED',
    'RATE_LIMITED',
    'RESOURCE_EXHAUSTED',
    'INTERNAL'
  ]),
  message: z.string().max(512),
  retryAfterMs: z.number().int().nonnegative().optional(),
  details: z.record(z.string(), z.json()).optional()
})
export type RemoteFailure = z.infer<typeof remoteFailureSchema>
