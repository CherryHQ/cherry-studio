/**
 * Mistral API schemas
 * Based on actual API response from https://api.mistral.ai/v1/models
 * Verified: 2025-02-03
 */

import * as z from 'zod'

/**
 * Mistral model capabilities
 */
export const MistralCapabilitiesSchema = z.object({
  completion_chat: z.boolean(),
  function_calling: z.boolean(),
  completion_fim: z.boolean(),
  fine_tuning: z.boolean(),
  vision: z.boolean(),
  ocr: z.boolean().optional(),
  classification: z.boolean().optional(),
  moderation: z.boolean().optional(),
  audio: z.boolean().optional(),
  audio_transcription: z.boolean().optional()
})

/**
 * Single model entry from Mistral API
 */
export const MistralModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  owned_by: z.string(),
  capabilities: MistralCapabilitiesSchema,
  name: z.string(),
  description: z.string(),
  max_context_length: z.number(),
  aliases: z.array(z.string()),
  deprecation: z.string().nullable(),
  deprecation_replacement_model: z.string().nullable().optional(),
  default_model_temperature: z.number().nullable(),
  type: z.string()
})

/**
 * Mistral API response wrapper
 */
export const MistralResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(MistralModelSchema)
})

// Type exports
export type MistralCapabilities = z.infer<typeof MistralCapabilitiesSchema>
export type MistralModel = z.infer<typeof MistralModelSchema>
export type MistralResponse = z.infer<typeof MistralResponseSchema>
