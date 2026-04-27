import * as z from 'zod'

import { UniqueModelIdSchema } from './model'

/**
 * Canonical set of entity types that participate in cross-cutting features
 * (tagging, grouping, pinning). Single source of truth for schema validation
 * of entityType discriminators. DB storage is still `text()` on each table —
 * this enum enforces the value at the API boundary via Zod.
 */
export const EntityTypeSchema = z.enum(['assistant', 'topic', 'session', 'model', 'agent'])
export type EntityType = z.infer<typeof EntityTypeSchema>

// Agent ids are validated only as non-empty strings here, matching AgentEntitySchema.id
// (`packages/shared/data/api/schemas/agents.ts`). The generated format
// `agent_<timestamp>_<random>` is a creation-side detail; pin / tag references must accept
// historical and migrated ids that don't fit that template (including the `cherry-claw-default`
// builtin). Tightening this would silently reject pinning legitimate agents.
// TODO(agent-uuid-migration): collapse this back to UUID v4 once upstream agent ids migrate
//   to UUID; this loosening also weakens the EntityIdSchema union below to "any non-empty string".
//   Revert points: this file + pinSchemas.test.ts / pins.test.ts / tags.test.ts (same TODO token).
const AgentIdSchema = z.string().min(1)

/**
 * Canonical ID schema for any entity referenced polymorphically
 * (entity_tag, pin, group, ...). Most entity tables use UUID v4 primary keys;
 * models use the provider/model composite UniqueModelId; agents use opaque
 * non-empty strings (see AgentIdSchema).
 */
export const EntityIdSchema = z.union([z.uuidv4(), UniqueModelIdSchema, AgentIdSchema])
