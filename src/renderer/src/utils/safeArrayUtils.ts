/**
 * 安全数组工具函数
 * 提供一系列用于安全操作数组的函数，防止出现"Cannot read properties of undefined"类型的错误
 */

/**
 * 安全地对数组使用map方法
 * 如果数组为null或undefined，返回空数组
 */
export const safeMap = <T, U>(arr: T[] | undefined | null, fn: (item: T, index: number, array: T[]) => U): U[] => {
  if (!arr) return []
  return arr.map(fn)
}

/**
 * 类型安全版的map函数
 * 提供额外的类型检查，确保只处理符合预期类型的元素
 */
export const safeTypedMap = <T, U>(
  arr: any[] | undefined | null,
  typeGuard: (item: any) => item is T,
  fn: (item: T, index: number, array: T[]) => U
): U[] => {
  if (!arr) return []
  return arr.filter(typeGuard).map(fn)
}

/**
 * 安全地对数组使用filter方法
 * 如果数组为null或undefined，返回空数组
 */
export const safeFilter = <T>(
  arr: T[] | undefined | null,
  fn: (value: T, index: number, array: T[]) => boolean
): T[] => {
  if (!arr) return []
  return arr.filter(fn)
}

/**
 * 安全地获取数组的第一个元素
 * 如果数组为空、null或undefined，返回undefined
 */
export const safeFirst = <T>(arr: T[] | undefined | null): T | undefined => {
  if (!arr || arr.length === 0) return undefined
  return arr[0]
}

/**
 * 安全地访问数组的特定索引元素
 * 如果数组为null或undefined，或索引超出范围，返回undefined
 */
export const safeAt = <T>(arr: T[] | undefined | null, index: number): T | undefined => {
  if (!arr || index < 0 || index >= arr.length) return undefined
  return arr[index]
}

/**
 * 安全地扁平化嵌套数组
 * 如果数组为null或undefined，返回空数组
 */
export const safeFlat = <T>(arr: (T[] | undefined | null)[] | undefined | null): T[] => {
  if (!arr) return []
  return arr.flatMap((subArr) => subArr || [])
}

/**
 * 安全地使用reduce方法
 * 如果数组为null或undefined，返回初始值
 */
export const safeReduce = <T, U>(
  arr: T[] | undefined | null,
  fn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U,
  initialValue: U
): U => {
  if (!arr) return initialValue
  return arr.reduce(fn, initialValue)
}

/**
 * 安全地检查数组中是否包含某个元素
 * 如果数组为null或undefined，返回false
 */
export const safeIncludes = <T>(arr: T[] | undefined | null, value: T): boolean => {
  if (!arr) return false
  return arr.includes(value)
}

/**
 * 安全地使用find方法
 * 如果数组为null或undefined，返回undefined
 */
export const safeFind = <T>(
  arr: T[] | undefined | null,
  fn: (value: T, index: number, array: T[]) => boolean
): T | undefined => {
  if (!arr) return undefined
  return arr.find(fn)
}

/**
 * 安全地使用findIndex方法
 * 如果数组为null或undefined，返回-1
 */
export const safeFindIndex = <T>(
  arr: T[] | undefined | null,
  fn: (value: T, index: number, array: T[]) => boolean
): number => {
  if (!arr) return -1
  return arr.findIndex(fn)
}

/**
 * 安全地获取数组长度
 * 如果数组为null或undefined，返回0
 */
export const safeLength = <T>(arr: T[] | undefined | null): number => {
  if (!arr) return 0
  return arr.length
}

/**
 * 安全地检查数组是否为空
 * 如果数组为null或undefined，返回true
 */
export const safeIsEmpty = <T>(arr: T[] | undefined | null): boolean => {
  return !arr || arr.length === 0
}

/**
 * 安全地确保返回一个数组
 * 如果输入为null或undefined，返回空数组
 */
export const safeArray = <T>(arr: T[] | undefined | null): T[] => {
  return arr || []
}
