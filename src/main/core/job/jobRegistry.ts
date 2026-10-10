/**
 * Compile-time type catalog for Job payload binding.
 *
 * Business modules extend this interface via TypeScript declaration merging to
 * register their type → payload mapping. The RUNTIME handler Map is stored
 * inside JobManager and is unrelated to this interface — do not confuse them.
 *
 * Example (in a business module that handles 'foo.bar' type jobs):
 *
 *   declare module '@main/core/job/jobRegistry' {
 *     interface JobRegistry {
 *       'foo.bar': { itemId: string; threshold: number }
 *     }
 *   }
 *
 * After this declaration:
 *   - `jobManager.enqueue('foo.bar', { itemId, threshold })` is type-checked
 *   - Passing `{ wrong: 'shape' }` is a compile error
 *   - Renaming 'foo.bar' surfaces every call site via the type system
 *
 * Path-alias note: the `declare module` path MUST match the tsconfig paths
 * alias exactly — project uses `@main/*` → `./src/main/*`, so this file is
 * `@main/core/job/jobRegistry`. Mismatches make declaration merging silently
 * no-op (no compile error, just lost type binding).
 */

export interface JobRegistry {}

/** All type strings registered in JobRegistry (compile-time enumeration). */
export type JobType = keyof JobRegistry & string

/** Payload type for a given job type. */
export type JobPayloadOf<K extends JobType> = JobRegistry[K]
