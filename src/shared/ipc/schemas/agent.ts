import * as z from 'zod'

import { defineRoute } from '../define'

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

/** The editor caps a single write well below the 1 MB viewer slice (UTF-8 bytes can exceed char count). */
export const AGENT_MEMORY_MAX_WRITE_CHARS = 1_000_000

export const agentRequestSchemas = {
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
  })
}
