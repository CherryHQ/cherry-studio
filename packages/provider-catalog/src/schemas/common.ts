/**
 * Common type definitions for the catalog system
 * Shared across model, provider, and override schemas
 */

import * as z from 'zod'

// Common string types for reuse
export const ModelIdSchema = z.string()
export const ProviderIdSchema = z.string()
export const VersionSchema = z.string()

// Timestamp schema for date fields
export const TimestampSchema = z.iso.datetime()

// Range helper schemas
export const NumericRangeSchema = z.object({
  min: z.number(),
  max: z.number()
})

export const StringRangeSchema = z.object({
  min: z.string(),
  max: z.string()
})

// Supported currencies for pricing
export const CurrencySchema = z.enum(['USD', 'CNY']).default('USD').optional()

// Price per token schema
// Default currency is USD if not specified
// Allow null for perMillionTokens to handle incomplete pricing data from APIs
export const PricePerTokenSchema = z.object({
  perMillionTokens: z.number().nonnegative().nullable(),
  currency: CurrencySchema
})

// Generic metadata schema
export const MetadataSchema = z.record(z.string(), z.any()).optional()

// Type exports
export type ModelId = z.infer<typeof ModelIdSchema>
export type ProviderId = z.infer<typeof ProviderIdSchema>
export type Version = z.infer<typeof VersionSchema>
export type Timestamp = z.infer<typeof TimestampSchema>
export type NumericRange = z.infer<typeof NumericRangeSchema>
export type StringRange = z.infer<typeof StringRangeSchema>
export type Currency = z.infer<typeof CurrencySchema>
export type PricePerToken = z.infer<typeof PricePerTokenSchema>
export type Metadata = z.infer<typeof MetadataSchema>

// Common validation utilities
export const validateRange = (min: number, max: number): boolean => {
  return min <= max
}

export const validatePositiveNumber = (value: number): boolean => {
  return value >= 0
}

export const validateNonEmptyString = (value: string): boolean => {
  return value.trim().length > 0
}
