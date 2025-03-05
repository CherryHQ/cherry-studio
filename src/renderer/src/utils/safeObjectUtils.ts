/**
 * 安全对象工具函数
 * 提供一系列用于安全访问对象属性的函数，防止出现"Cannot read properties of undefined"类型的错误
 */

/**
 * 安全地访问对象的属性
 * 如果对象为null或undefined，返回undefined
 */
export const safeGet = <T, K extends keyof T>(obj: T | undefined | null, key: K): T[K] | undefined => {
  if (!obj) return undefined
  return obj[key]
}

/**
 * 安全地获取对象的数组属性
 * 如果对象为null或undefined，或指定的属性不存在，返回空数组
 */
export const safeArrayGet = <T>(obj: { [key: string]: T[] } | undefined | null, key: string): T[] => {
  if (!obj || !obj[key]) return []
  return obj[key]
}

/**
 * 创建安全对象代理，允许安全地访问任意深度的属性
 * 无论访问链上的任何属性是否存在，都不会抛出错误
 */
export const safePath = <T>(obj: T | null | undefined): any => {
  return new Proxy({} as any, {
    get: (target, prop) => {
      if (obj && typeof obj === 'object' && prop in obj) {
        const value = (obj as any)[prop]
        if (value && typeof value === 'object') {
          return safePath(value)
        }
        return value
      }
      return safePath(undefined)
    }
  })
}

/**
 * 创建默认对象，确保对象始终存在
 * 如果对象为null或undefined，返回一个具有默认值的新对象
 */
export const safeObject = <T extends object>(obj: T | undefined | null, defaultObj: T): T => {
  return obj || defaultObj
}
