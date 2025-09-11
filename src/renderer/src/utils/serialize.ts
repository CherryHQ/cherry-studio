import { isSerializable } from '@renderer/types/serialize'

/**
 * 安全地序列化一个值为 JSON 字符串。
 * 基于 `Serializable` 类型和 `isSerializable` 运行时检查。
 *
 * @param value 要序列化的值
 * @param options 配置选项
 * @returns 序列化后的字符串，或 null（如果失败且未抛错）
 */
export function safeSerialize(
  value: unknown,
  options: {
    /**
     * 处理不可序列化值的方式：
     * - 'error': 抛出错误
     * - 'omit': 尝试过滤掉非法字段（⚠️ 不支持深度修复，仅顶层判断）
     * - 'serialize': 尝试安全转换（如 Date → ISO 字符串）
     */
    onError?: 'error' | 'omit' | 'serialize'

    /**
     * 是否美化输出
     * @default true
     */
    pretty?: boolean
  } = {}
): string | null {
  const { onError = 'serialize', pretty = true } = options
  const space = pretty ? 2 : undefined

  // 1. 如果本身就是合法的 Serializable 值，直接序列化
  if (isSerializable(value)) {
    try {
      return JSON.stringify(value, null, space)
    } catch (err) {
      // 理论上不会发生，但以防万一（比如极深嵌套栈溢出）
      if (onError === 'error') {
        throw new Error(`Failed to stringify serializable value: ${err instanceof Error ? err.message : err}`)
      }
      return null
    }
  }

  // 2. 不是可序列化的，根据策略处理
  switch (onError) {
    case 'error':
      throw new TypeError('Value is not serializable and cannot be safely serialized.')

    case 'omit':
      // 注意：这里不能“修复”对象，只能返回 null 表示跳过
      return null

    case 'serialize': {
      // 宽容模式：尝试做一些安全转换
      return tryLenientSerialize(value, space)
    }
  }
}

/**
 * 尽力而为地序列化一个值，即使它不符合 Serializable。
 * 适用于调试、日志等非关键场景。
 */
function tryLenientSerialize(value: unknown, space?: string | number): string {
  const seen = new WeakSet()

  const serialized = JSON.stringify(
    value,
    (_, val: any) => {
      // 处理循环引用
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          return '[Circular]'
        }
        seen.add(val)
      }

      // 处理特殊类型
      if (val instanceof Date) return val.toISOString()
      if (val instanceof RegExp) return `{RegExp: "${val.toString()}"}`
      if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`
      if (typeof val === 'symbol') return `Symbol(${String(val.description)})`
      if (val instanceof Map) return Object.fromEntries(val.entries())
      if (val instanceof Set) return Array.from(val)
      if (val === undefined) return '[undefined]'

      return val
    },
    space
  )

  return serialized
}
