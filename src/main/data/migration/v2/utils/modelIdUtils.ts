/**
 * Re-export UniqueModelId utilities from shared types.
 *
 * Migration code should use the canonical `createUniqueModelId` / `UniqueModelId`
 * from `@shared/data/types/model` — there is no separate "composite" type.
 */
export { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
