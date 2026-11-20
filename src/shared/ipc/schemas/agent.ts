import * as z from 'zod'

import { AGENT_MEMORY_MAX_WRITE_CHARS } from '@shared/ai/agentMemory'

import { defineRoute } from '../define'
import { ImageBytesSchema } from './entityImage'

/**
 * Agent Filesystem IPC — read-only access to the identity/memory files that live
 * in the per-agent data directory (`Data/Agents/<agentId>/`). The renderer only
 * ever receives fixed, known files; the handler never accepts a path.
 */
export const AgentMemoryFileKeySchema = z.enum(['soul', 'user', 'fact', 'journal'])
export type AgentMemoryFileKey = z.infer<typeof AgentMemoryFileKeySchema>

export const AgentMemoryFileSchema = z.object({
  key: AgentMemoryFileKeySchema,
  /** File name only, e.g. `FACT.md` — never a full path chosen by the caller. */
  name: z.string(),
  /** Absolute path for display/copy. Derived main-side from the agent id. */
  path: z.string(),
  exists: z.boolean(),
  size: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  /** Opaque revision (`size:mtimeMs`, or `missing`); saves must present the version they loaded. */
  version: z.string(),
  content: z.string(),
  /** True when only part of an oversized file is returned. */
  truncated: z.boolean()
})
export type AgentMemoryFile = z.infer<typeof AgentMemoryFileSchema>

export const AgentMemorySnapshotSchema = z.object({
  directory: z.string(),
  files: z.array(AgentMemoryFileSchema)
})
export type AgentMemorySnapshot = z.infer<typeof AgentMemorySnapshotSchema>

const AgentIdInputSchema = z.strictObject({ agentId: z.string().min(1).max(200) })

/** An Agent's prompt-relevant settings as currently edited; `agentId` is absent while creating one. */
export const AgentSystemPromptDraftSchema = z.strictObject({
  agentId: z.string().min(1).max(200).optional(),
  instructions: z.string(),
  /** As `configuration.language`: a label, `null` for none, absent to follow the global setting. */
  language: z.string().nullable().optional(),
  skillIds: z.array(z.string()),
  disabledTools: z.array(z.string()),
  knowledgeBaseIds: z.array(z.string()),
  mcpServerIds: z.array(z.string())
})
export type AgentSystemPromptDraft = z.infer<typeof AgentSystemPromptDraftSchema>

/** `guidance` blocks may be replaced per Agent; `live` and `setting` blocks follow data and settings. */
export const AgentPromptBlockSchema = z.object({
  key: z.string(),
  kind: z.enum(['guidance', 'instructions', 'live', 'setting']),
  text: z.string()
})
export type AgentPromptBlockPreview = z.infer<typeof AgentPromptBlockSchema>

/** The full system prompt as generated blocks, in the order the runtime sends them. */
export const AgentSystemPromptPreviewSchema = z.object({
  blocks: z.array(AgentPromptBlockSchema),
  /** A built-in Agent's own prompt, which applies while it has no instructions of its own. */
  builtinInstructions: z.string().optional()
})
export type AgentSystemPromptPreview = z.infer<typeof AgentSystemPromptPreviewSchema>

export const agentRequestSchemas = {
  'agent.set_avatar': defineRoute({
    input: z.strictObject({
      agentId: z.string().min(1).max(200),
      avatar: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('image'), data: ImageBytesSchema }),
        z.strictObject({ kind: z.literal('emoji'), emoji: z.emoji() }),
        z.strictObject({ kind: z.literal('default') })
      ])
    }),
    output: z.void()
  }),
  'agent.memory.read': defineRoute({
    input: AgentIdInputSchema,
    output: AgentMemorySnapshotSchema
  }),
  'agent.memory.write': defineRoute({
    input: AgentIdInputSchema.extend({
      key: AgentMemoryFileKeySchema,
      content: z.string().max(AGENT_MEMORY_MAX_WRITE_CHARS),
      /** The `version` returned when the editor loaded the file. */
      expectedVersion: z.string()
    }),
    output: AgentMemoryFileSchema
  }),
  'agent.memory.open_folder': defineRoute({
    input: AgentIdInputSchema,
    output: z.void()
  }),
  /** The Pi Durable system prompt the runtime would send for this draft. */
  'agent.system_prompt.preview': defineRoute({
    input: AgentSystemPromptDraftSchema,
    output: AgentSystemPromptPreviewSchema
  })
}
