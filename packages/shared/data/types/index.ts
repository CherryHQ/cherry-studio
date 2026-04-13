/**
 * Shared data type utilities
 *
 * Common constants and helpers used across entity type definitions.
 */

/**
 * Fields auto-managed by the database layer (primary key + timestamps).
 * Use with `Omit<Entity, keyof typeof AutoFields>` to derive create/update DTOs.
 */
export const AutoFields = { id: true, createdAt: true, updatedAt: true } as const
