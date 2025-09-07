export type Serializable = null | boolean | number | string | { [key: string]: SerializableValue } | SerializableValue[]

// FIXME: any 不是可安全序列化的类型，但是递归定义会报ts2589
type SerializableValue = null | boolean | number | string | { [key: string]: any } | any[]

/**
 * 判断一个值是否可序列化（适合用于 Redux 状态）
 * 支持嵌套对象、数组的深度检测
 */

export function isSerializable(value: unknown): boolean {
  const seen = new Set() // 用于防止循环引用

  function _isSerializable(val: unknown): boolean {
    if (val === null || val === undefined) {
      return val !== undefined // null ✅, undefined ❌
    }

    const type = typeof val

    if (type === 'string' || type === 'number' || type === 'boolean') {
      return true
    }

    if (type === 'object') {
      // 检查循环引用
      if (seen.has(val)) {
        return true // 避免无限递归，假设循环引用对象本身结构合法（但实际 JSON.stringify 会报错）
      }
      seen.add(val)

      if (Array.isArray(val)) {
        return val.every((item) => _isSerializable(item))
      }

      // 检查是否为纯对象（plain object）
      const proto = Object.getPrototypeOf(val)
      if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
        return false // 不是 plain object，比如 class 实例
      }

      // 检查内置对象（如 Date、RegExp、Map、Set 等）
      if (
        val instanceof Date ||
        val instanceof RegExp ||
        val instanceof Map ||
        val instanceof Set ||
        val instanceof Error ||
        val instanceof File ||
        val instanceof Blob
      ) {
        return false
      }

      // 递归检查所有属性值
      return Object.values(val).every((v) => _isSerializable(v))
    }

    // function、symbol 不可序列化
    return false
  }

  try {
    return _isSerializable(value)
  } catch {
    return false // 如出现循环引用错误等
  }
}
