/**
 * 安全的 Array.filter 实现，当传入非数组时返回空数组
 * @param arr 要过滤的数组
 * @param predicate 过滤条件
 * @returns 过滤后的数组
 */
export function safeFilter<T>(
  arr: T[] | null | undefined,
  predicate: (value: T, index: number, array: T[]) => boolean
): T[] {
  if (!Array.isArray(arr)) return []
  return arr.filter(predicate)
}

/**
 * 安全的 Array.map 实现，当传入非数组时返回空数组
 * @param arr 要映射的数组
 * @param callback 映射函数
 * @returns 映射后的数组
 */
export function safeMap<T, U>(arr: T[] | null | undefined, callback: (value: T, index: number, array: T[]) => U): U[] {
  if (!Array.isArray(arr)) return []
  return arr.map(callback)
}
