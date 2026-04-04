/**
 * Common type definitions for the catalog system
 * Shared across model, provider, and override schemas
 */

import * as z from 'zod'

// Common string types for reuse
export const ModelIdSchema = z.string()
export const ProviderIdSchema = z.string()

/** Version in YYYY-MM-DD format */
export const VersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Version must be in YYYY-MM-DD format'
})

/** ISO 8601 datetime timestamp */
export const ISOTimestampSchema = z.iso.datetime()

// Range helper schemas
export const NumericRangeSchema = z
  .object({
    min: z.number(),
    max: z.number()
  })
  .refine((r) => r.min <= r.max, {
    message: 'min must be less than or equal to max'
  })

export const StringRangeSchema = z.object({
  min: z.string(),
  max: z.string()
})

// Supported currencies for pricing
export const ZodCurrencySchema = z.enum(['USD', 'CNY']).default('USD').optional()

// Price per token schema
// Default currency is USD if not specified
// Allow null for perMillionTokens to handle incomplete pricing data from APIs
export const PricePerTokenSchema = z.object({
  perMillionTokens: z.number().nonnegative().nullable(),
  currency: ZodCurrencySchema
})

// Generic metadata schema
export const MetadataSchema = z.record(z.string(), z.unknown()).optional()

// Type exports
export type ModelId = z.infer<typeof ModelIdSchema>
export type ProviderId = z.infer<typeof ProviderIdSchema>
export type Version = z.infer<typeof VersionSchema>
export type ISOTimestamp = z.infer<typeof ISOTimestampSchema>
export type NumericRange = z.infer<typeof NumericRangeSchema>
export type StringRange = z.infer<typeof StringRangeSchema>
export type ZodCurrency = z.infer<typeof ZodCurrencySchema>
export type PricePerToken = z.infer<typeof PricePerTokenSchema>
export type Metadata = z.infer<typeof MetadataSchema>
