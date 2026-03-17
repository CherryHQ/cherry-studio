/**
 * models.dev API schemas
 * Based on https://models.dev/api.json
 */

import * as z from 'zod'

/** Model definition from models.dev */
export const ModelsDevModelSchema = z.object({
  /** Model identifier */
  id: z.string(),

  /** Display name */
  name: z.string(),

  /** Model family (e.g., "gpt", "claude", "gemini") */
  family: z.string().optional(),

  /** Supports file/image attachments */
  attachment: z.boolean().optional().default(false),

  /** Supports reasoning/thinking */
  reasoning: z.boolean().optional().default(false),

  /** Supports function/tool calling */
  tool_call: z.boolean().optional().default(false),

  /** Supports structured output (JSON mode) */
  structured_output: z.boolean().optional(),

  /** Supports temperature parameter */
  temperature: z.boolean().optional().default(true),

  /** Knowledge cutoff date (YYYY-MM format) */
  knowledge: z.string().optional(),

  /** Release date */
  release_date: z.string().optional(),

  /** Last updated date */
  last_updated: z.string().optional(),

  /** Input/output modalities */
  modalities: z
    .object({
      input: z.array(z.string()),
      output: z.array(z.string())
    })
    .optional(),

  /** Whether weights are publicly available */
  open_weights: z.boolean().optional(),

  /** Pricing per million tokens */
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cache_read: z.number().optional()
    })
    .optional(),

  /** Token limits */
  limit: z
    .object({
      context: z.number(),
      output: z.number()
    })
    .optional(),

  /** Interleaved reasoning config (for thinking models) - can be boolean or object */
  interleaved: z
    .union([
      z.boolean(),
      z.object({
        field: z.string()
      })
    ])
    .optional()
})

/** Provider definition from models.dev */
export const ModelsDevProviderSchema = z.object({
  /** Provider identifier */
  id: z.string(),

  /** Environment variable names for API keys */
  env: z.array(z.string()).optional().default([]),

  /** npm package for AI SDK */
  npm: z.string().optional(),

  /** API base URL */
  api: z.string().optional(),

  /** Provider display name */
  name: z.string(),

  /** Documentation URL */
  doc: z.string().optional(),

  /** Models provided by this provider */
  models: z.record(z.string(), ModelsDevModelSchema)
})

/** Full API response structure */
export const ModelsDevResponseSchema = z.record(z.string(), ModelsDevProviderSchema)

// Type exports
export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>
export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>
export type ModelsDevResponse = z.infer<typeof ModelsDevResponseSchema>
