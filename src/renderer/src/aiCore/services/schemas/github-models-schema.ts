/**
 * GitHub Models API Response Schema
 * Endpoint: GET /catalog/
 */
import * as z from 'zod'

// Single GitHub model
export const GitHubModelSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  publisher: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional()
})

// GitHub models response (array at root level based on legacy code)
export const GitHubModelsResponseSchema = z.array(GitHubModelSchema)

// Types derived from schemas
export type GitHubModelResponse = z.infer<typeof GitHubModelSchema>
export type GitHubModelsResponse = z.infer<typeof GitHubModelsResponseSchema>
