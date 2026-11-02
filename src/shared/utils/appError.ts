import * as z from 'zod'

import type { AppErrorContext } from '../types/appError'

export {
  createAppErrorContext,
  createAppErrorId,
  projectAppErrorContext,
  summarizeErrorParams,
  summarizeProviderResponse
} from './appErrorSnapshot'

const MESSAGE_LIMIT = 4_000

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

/** IPC and bundle boundary for one fault snapshot. Rejects missing identity and non-scalar params. */
export const appErrorContextSchema = z
  .object({
    id: z.string().trim().min(1),
    occurredAt: z.string().trim().min(1),
    source: z.string().trim().min(1),
    operation: z.string().trim().min(1),
    message: z.string(),
    name: z.string().optional(),
    stack: z.string().optional(),
    statusCode: z.number().int().nonnegative().max(999).optional(),
    responseBody: z.string().min(1).max(MESSAGE_LIMIT).optional(),
    providerId: z.string().trim().min(1).optional(),
    modelId: z.string().trim().min(1).optional(),
    recordId: z.string().trim().min(1).optional(),
    params: z.record(z.string(), scalarSchema).optional(),
    imageOnly: z.boolean().optional()
  })
  .strict()

/** Structural guard backed by `appErrorContextSchema`. Does not invent missing fields. */
export function isAppErrorContext(value: unknown): value is AppErrorContext {
  return appErrorContextSchema.safeParse(value).success
}
