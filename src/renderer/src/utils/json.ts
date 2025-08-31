/**
 * 判断字符串是否是 json 字符串
 * @param {any} str 字符串
 * @returns {boolean} 是否为 json 字符串
 */
export function isJSON(str: any): boolean {
  if (typeof str !== 'string') {
    return false
  }

  try {
    return typeof JSON.parse(str) === 'object'
  } catch (e) {
    return false
  }
}

/**
 * 尝试解析 JSON 字符串，如果解析失败则返回 null。
 * @param {string} str 要解析的字符串
 * @returns {any | null} 解析后的对象，解析失败返回 null
 */
export function parseJSON(str: string): any | null {
  try {
    return JSON.parse(str)
  } catch (e) {
    return null
  }
}

/**
 * 递归解析 JSON 字符串，会尝试解析字符串中嵌套的 JSON 字符串
 * @param {string} str 要解析的字符串
 * @returns {unknown | null} 解析后的对象，解析失败返回 null
 */
export function parseJsonRecursive(str: string): unknown | null {
  try {
    const result = JSON.parse(str)

    const processValue = (value) => {
      if (typeof value === 'string') {
        const parsedValue = parseJsonRecursive(value)
        return parsedValue !== null ? parsedValue : value
      } else if (value && typeof value === 'object') {
        const parsedValue = parseJsonRecursive(JSON.stringify(value))
        return parsedValue !== null ? parsedValue : value
      } else {
        return value
      }
    }

    if (result && typeof result === 'object') {
      if (Array.isArray(result)) {
        return result.map(processValue)
      } else {
        const parsedObject: Record<string, any> = {}
        for (const [key, value] of Object.entries(result)) {
          parsedObject[key] = processValue(value)
        }
        return parsedObject
      }
    } else if (Array.isArray(result)) {
      return result.map(processValue)
    }

    return result
  } catch (e) {
    return null
  }
}
