/**
 * 判断字符串是否是 json 字符串
 * @param str 字符串
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
 * @param str 要解析的字符串
 * @returns 解析后的对象，如果解析失败则返回 null
 */
export function parseJSON(str: string) {
  try {
    return JSON.parse(str)
  } catch (e) {
    return null
  }
}
