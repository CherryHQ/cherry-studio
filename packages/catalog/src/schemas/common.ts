/**
 * Common type definitions for the catalog system
 * Shared across model, provider, and override schemas
 */

import * as z from 'zod'

// Common string types for reuse
export const ModelIdSchema = z.string()
export const ProviderIdSchema = z.string()
export const VersionSchema = z.string()

// Currency codes
export const CurrencySchema = z.enum(['USD', 'EUR', 'CNY', 'JPY', 'GBP'])

// Common file size units
export const FileSizeUnitSchema = z.enum(['B', 'KB', 'MB', 'GB'])

// Common status types
export const StatusSchema = z.enum(['active', 'inactive', 'deprecated', 'maintenance'])

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

// Price per token schema (snake_case)
export const PricePerTokenSchema = z.object({
  per_million_tokens: z.number().nonnegative(),
  currency: CurrencySchema.default('USD')
})

// Generic metadata schema
export const MetadataSchema = z.record(z.string(), z.any()).optional()

// Type exports
export type ModelId = z.infer<typeof ModelIdSchema>
export type ProviderId = z.infer<typeof ProviderIdSchema>
export type Version = z.infer<typeof VersionSchema>
export type Currency = z.infer<typeof CurrencySchema>
export type FileSizeUnit = z.infer<typeof FileSizeUnitSchema>
export type Status = z.infer<typeof StatusSchema>
export type Timestamp = z.infer<typeof TimestampSchema>
export type NumericRange = z.infer<typeof NumericRangeSchema>
export type StringRange = z.infer<typeof StringRangeSchema>
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
