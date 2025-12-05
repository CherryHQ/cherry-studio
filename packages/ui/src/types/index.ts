/**
 * Makes specified properties required while keeping others as is
 * @template T - The object type to modify
 * @template K - Keys of T that should be required
 * @example
 * type User = {
 *   name?: string;
 *   age?: number;
 * }
 *
 * type UserWithName = RequireSome<User, 'name'>
 * // Result: { name: string; age?: number; }
 */
// The type is copied from src/renderer/src/types/index.ts.
export type RequireSome<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
