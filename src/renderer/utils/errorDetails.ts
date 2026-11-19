/**
 * Dependency-light error → string helpers.
 *
 * This module sits on every window's first-screen graph through the fatal
 * fallbacks (ErrorBoundary / WindowFatalFallback / RouteErrorFallback), so it
 * must never import the heavy error-classification bucket (zod, axios, ai,
 * agent schemas) — that lives in `./error`. Guarded by import-graph probes in
 * `__tests__/errorDetails.test.ts`.
 */
export function getErrorDetails(err: any, seen = new WeakSet()): any {
  if (err === null || typeof err !== 'object') {
    return err
  }

  // Error fallbacks must stay serializable even when a cause points back to its parent.
  if (seen.has(err)) return '[Circular]'

  seen.add(err)
  const result: any = {}

  // Get all enumerable properties, including those from the prototype chain
  const allProps = new Set([...Object.getOwnPropertyNames(err), ...Object.keys(err)])

  for (const prop of allProps) {
    try {
      const value = err[prop]
      // Skip function properties
      if (typeof value === 'function') continue
      // Recursively process nested objects
      result[prop] = getErrorDetails(value, seen)
    } catch (e) {
      result[prop] = '<Unable to access property>'
    }
  }

  seen.delete(err)
  return result
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error boundaries receive arbitrary thrown values; detail formatting must remove sensitive metadata and always return display text.
export function formatErrorDetails(error: unknown): string {
  try {
    const detailedError = getErrorDetails(error)
    delete detailedError?.headers
    delete detailedError?.stack
    delete detailedError?.request_id
    if (!detailedError) return ''
    const message = typeof detailedError.message === 'string' ? detailedError.message : undefined
    if (message) return message
    const formattedJson = safeToString(detailedError, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
    return `Error Details:\n${formattedJson}`
  } catch {
    return '[Unserializable]'
  }
}

/** Read rejection text without allowing unreadable diagnostics to interrupt error handling. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Browser, worker and IPC failures can contain arbitrary values or unreadable Error fields; preserve readable text and bound formatting failure.
export function readErrorMessage(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error)
  } catch {
    return '[Unserializable]'
  }
}

/** Preserve native Error identity and readable rejection text while safely wrapping other failures. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC, readers and mutations can reject with any value; normalization must not replace that failure with a formatting exception.
export function toError(error: unknown): Error {
  try {
    return error instanceof Error ? error : new Error(readErrorMessage(error))
  } catch {
    return new Error('[Unserializable]')
  }
}

/**
 * 将任意值安全地转换为字符串
 * @param value - 需要转换的值，unknown 类型
 * @param space - JSON 对象和数组的缩进宽度，默认不缩进
 * @returns 转换后的字符串
 *
 * @description
 * 该函数可以安全地处理以下情况:
 * - null 和 undefined 会被转换为 'null'
 * - 字符串直接返回
 * - 原始类型(数字、布尔值、bigint等)使用 String() 转换
 * - 对象和数组会尝试使用 JSON.stringify 序列化，并处理循环引用
 * - 如果序列化失败，返回固定的不可序列化标记
 *
 * @example
 * ```ts
 * safeToString(null)  // 'null'
 * safeToString('test')  // 'test'
 * safeToString(123)  // '123'
 * safeToString({a: 1})  // '{"a":1}'
 * ```
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error diagnostics may contain arbitrary values and throwing serialization hooks; formatting must always return text.
export function safeToString(value: unknown, space?: number): string {
  if (value == null) {
    return 'null'
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return typeof value === 'object' ? (JSON.stringify(value, getCircularReplacer(), space) ?? 'null') : String(value)
  } catch {
    return '[Unserializable]'
  }
}

// 防止循环引用导致的 JSON.stringify 崩溃
function getCircularReplacer() {
  const ancestors: object[] = []
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON.stringify provides the holder and arbitrary nested values; only the current ancestor path establishes a cycle.
  return function (this: unknown, _key: string, value: unknown) {
    if (typeof value === 'object' && value !== null) {
      while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop()
      if (ancestors.includes(value)) {
        return '[Circular]'
      }
      ancestors.push(value)
    }
    return value
  }
}
