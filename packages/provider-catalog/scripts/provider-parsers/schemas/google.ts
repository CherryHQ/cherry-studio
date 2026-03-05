/**
 * Google (Gemini) API schemas
 * Based on actual API response from https://generativelanguage.googleapis.com/v1beta/models
 * Verified: 2025-02-03
 *
 * Note: Google uses different field names:
 * - models[] instead of data[]
 * - name instead of id (e.g., "models/gemini-2.5-flash")
 * - inputTokenLimit/outputTokenLimit instead of context_length
 */

import * as z from 'zod'

/**
 * Single model entry from Google API
 */
export const GoogleModelSchema = z.object({
  name: z.string(),
  version: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  inputTokenLimit: z.number(),
  outputTokenLimit: z.number(),
  supportedGenerationMethods: z.array(z.string()),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  maxTemperature: z.number().optional(),
  thinking: z.boolean().optional()
})

/**
 * Google API response wrapper
 */
export const GoogleResponseSchema = z.object({
  models: z.array(GoogleModelSchema)
})

// Type exports
export type GoogleModel = z.infer<typeof GoogleModelSchema>
export type GoogleResponse = z.infer<typeof GoogleResponseSchema>
