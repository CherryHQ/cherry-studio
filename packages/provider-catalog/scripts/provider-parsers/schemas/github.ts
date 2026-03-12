/**
 * GitHub Models API schemas
 * Based on actual API response from https://models.github.ai/catalog/models
 * Verified: 2025-02-03
 *
 * GitHub Models has:
 * - Name, publisher, summary
 * - Rate limit tier
 * - Input/output modalities
 * - Tags
 * - Capabilities (streaming, tool-calling, reasoning, etc.)
 * - Limits (max_input_tokens, max_output_tokens)
 */

import * as z from 'zod'

/**
 * Limits schema for GitHub Models
 */
export const GitHubLimitsSchema = z.object({
  max_input_tokens: z.number(),
  max_output_tokens: z.number().nullable()
})

/**
 * Single model entry from GitHub Models API
 */
export const GitHubModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  publisher: z.string(),
  summary: z.string(),
  rate_limit_tier: z.string(),
  supported_input_modalities: z.array(z.string()),
  supported_output_modalities: z.array(z.string()),
  tags: z.array(z.string()),
  registry: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
  limits: GitHubLimitsSchema,
  html_url: z.string()
})

/**
 * GitHub Models API response (direct array)
 */
export const GitHubResponseSchema = z.array(GitHubModelSchema)

// Type exports
export type GitHubLimits = z.infer<typeof GitHubLimitsSchema>
export type GitHubModel = z.infer<typeof GitHubModelSchema>
export type GitHubResponse = z.infer<typeof GitHubResponseSchema>
