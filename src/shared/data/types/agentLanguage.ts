// TODO: Move this contract into types/agent.ts once that module no longer
// re-exports from api/schemas/agents.ts.
import * as z from 'zod'

/**
 * Human-readable reply-language label ("English", "ไทย"), not an app locale code.
 * Shared by the per-agent `configuration.language` field, the global `agent.language`
 * preference type, and the prompt-injection resolver in `@main/ai/utils/agentLanguage`.
 */
export const AgentLanguageSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine((value) => !/[\r\n]/.test(value), { message: 'Language must be a single line' })
export type AgentLanguage = z.infer<typeof AgentLanguageSchema>
