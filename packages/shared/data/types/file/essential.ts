import * as z from 'zod'

/** Millisecond epoch timestamp (non-negative integer) */
export const TimestampSchema = z.int().nonnegative()

/** Name schema with security validations: rejects null bytes, path separators, and traversal sequences */
export const SafeNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !s.includes('\0'), 'Name must not contain null bytes')
  .refine((s) => !/[/\\]/.test(s), 'Name must not contain path separators')
  .refine((s) => !/^\.\.?$/.test(s), 'Name must not be . or ..')
