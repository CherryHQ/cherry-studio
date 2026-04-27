import * as z from 'zod'

import { UniqueModelIdSchema } from './model'

/**
 * Canonical set of entity types that participate in cross-cutting features
 * (tagging, grouping, pinning). Single source of truth for schema validation
 * of entityType discriminators. DB storage is still `text()` on each table —
 * this enum enforces the value at the API boundary via Zod.
 */
export const EntityTypeSchema = z.enum(['assistant', 'topic', 'session', 'model'])
export type EntityType = z.infer<typeof EntityTypeSchema>

/**
 * Canonical ID schema for any entity referenced polymorphically
 * (entity_tag, pin, group, ...). Most entity tables use UUID v4 primary keys;
 * models use the provider/model composite UniqueModelId.
 */
export const EntityIdSchema = z.union([z.uuidv4(), UniqueModelIdSchema])
