import * as z from 'zod'

/**
 * Canonical set of entity types that participate in cross-cutting features
 * (tagging, grouping, pinning). Single source of truth for schema validation
 * of entityType discriminators. DB storage is still `text()` on each table —
 * this enum enforces the value at the API boundary via Zod.
 */
export const EntityTypeSchema = z.enum(['assistant', 'topic', 'session'])
export type EntityType = z.infer<typeof EntityTypeSchema>

/**
 * Canonical ID schema for any entity referenced polymorphically
 * (entity_tag, pin, group, ...). All entity tables use UUID v4 primary keys.
 */
export const EntityIdSchema = z.uuidv4()
