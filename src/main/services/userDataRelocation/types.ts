import type { BootConfigSchema } from '@shared/data/bootConfig/bootConfigSchemas'

/**
 * Relocation state as persisted under the `temp.user_data_relocation`
 * BootConfig key. The shared zod schema is the single source of truth; these
 * aliases only name its variants for domain code.
 */
export type RelocationState = NonNullable<BootConfigSchema['temp.user_data_relocation']>
export type PendingRelocation = Extract<RelocationState, { status: 'pending' }>
export type FailedRelocation = Extract<RelocationState, { status: 'failed' }>
