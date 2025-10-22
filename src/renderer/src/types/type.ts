export type Maybe<T> = T | undefined

/**
 * 获取对象的所有键名，并保持类型安全
 * @param obj - 要获取键名的对象
 * @returns 对象的所有键名数组，类型为对象键名的联合类型
 * @example
 * ```ts
 * const obj = { foo: 1, bar: 'hello' };
 * const keys = objectKeys(obj); // ['foo', 'bar']
 * ```
 */
export function objectKeys<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[]
}

/**
 * 将对象转换为键值对数组，保持类型安全
 * @template T - 对象类型
 * @param obj - 要转换的对象
 * @returns 键值对数组，每个元素是一个包含键和值的元组
 * @example
 * const obj = { name: 'John', age: 30 };
 * const entries = objectEntries(obj); // [['name', 'John'], ['age', 30]]
 */
export function objectEntries<T extends object>(obj: T): [keyof T, T[keyof T]][] {
  return Object.entries(obj) as [keyof T, T[keyof T]][]
}

/**
 * 将对象转换为键值对数组，提供更严格的类型检查
 * @template T - 对象类型，键必须是string、number或symbol，值可以是任意类型
 * @param obj - 要转换的对象
 * @returns 键值对数组，每个元素是一个包含键和值的元组，类型完全对应原对象的键值类型
 * @example
 * const obj = { name: 'John', age: 30 };
 * const entries = objectEntriesStrict(obj); // [['name', string], ['age', number]]
 */
export function objectEntriesStrict<T extends Record<string | number | symbol, unknown>>(
  obj: T
): { [K in keyof T]: [K, T[K]] }[keyof T][] {
  return Object.entries(obj) as { [K in keyof T]: [K, T[K]] }[keyof T][]
}

/**
 * 获取对象所有值的类型安全版本
 * @template T - 对象类型
 * @param obj - 要获取值的对象
 * @returns 对象值组成的数组
 * @example
 * const obj = { a: 1, b: 2 } as const;
 * const values = objectValues(obj); // (1 | 2)[]
 */
export function objectValues<T extends Record<string, unknown>>(obj: T): T[keyof T][] {
  return Object.values(obj) as T[keyof T][]
}

/**
 * 表示一个对象类型，该对象至少包含类型T中指定的所有键，这些键的值类型为U
 * 同时也允许包含其他任意string类型的键，这些键的值类型也必须是U
 * @template T - 必需包含的键的字面量字符串联合类型
 * @template U - 所有键对应值的类型
 * @example
 * type Example = AtLeast<'a' | 'b', number>;
 * // 结果类型允许:
 * const obj1: Example = { a: 1, b: 2 };           // 只包含必需的键
 * const obj2: Example = { a: 1, b: 2, c: 3 };     // 包含额外的键
 */
export type AtLeast<T extends string, U> = {
  [K in T]: U
} & {
  [key: string]: U
}

/**
 * 从对象中移除指定的属性键，返回新对象
 * @template T - 源对象类型
 * @template K - 要移除的属性键类型，必须是T的键
 * @param obj - 源对象
 * @param keys - 要移除的属性键列表
 * @returns 移除指定属性后的新对象
 * @example
 * ```ts
 * const obj = { a: 1, b: 2, c: 3 };
 * const result = strip(obj, ['a', 'b']);
 * // result = { c: 3 }
 * ```
 */
export function strip<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete (result as any)[key] // 类型上 Omit 已保证安全
  }
  return result
}

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
export type RequireSome<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
