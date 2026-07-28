/**
 * Common type definitions for the registry system
 * Shared across model, provider, and override schemas
 */

import * as z from 'zod'

import { CURRENCY, objectValues } from './enums'

export const ModelIdSchema = z.string().min(1)
export const ProviderIdSchema = z.string().min(1)

/**
 * Opaque change-detection token for a generated artifact. The generator stamps it with a hash of the
 * artifact's content, so equal content ⇒ equal version and ANY content change ⇒ new version — that's
 * the contract seeders rely on (`SeedRunner` skips a seeder whose journal version matches). Older
 * artifacts carried a generation date; treat the value as opaque, never parse it.
 */
export const VersionSchema = z.string().min(1)

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
export const ZodCurrencySchema = z.enum(objectValues(CURRENCY)).optional()

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
