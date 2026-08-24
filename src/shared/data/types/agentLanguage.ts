import * as z from 'zod'

/**
 * Human-readable reply-language label ("English", "ไทย"), not an app locale code.
 * Shared by the per-agent `configuration.language` field, the global `agent.language`
 * preference type, and the prompt-injection resolver in `@main/ai/utils/agentLanguage`.
 */
export const AgentLanguageSchema = z.string().trim().min(1).max(50)
export type AgentLanguage = z.infer<typeof AgentLanguageSchema>
