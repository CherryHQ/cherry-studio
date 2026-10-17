// TODO: unknown 代替 any
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
