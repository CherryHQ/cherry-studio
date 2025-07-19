/**
 * 对对象的键按照字典序进行排序（支持嵌套对象）
 * @param obj 需要排序的对象
 * @returns 返回排序后的新对象
 */
function sortedObjectByKeys(obj: object): object {
  const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b))

  const sortedObj = {}
  for (const key of sortedKeys) {
    let value = obj[key]
    // 如果值是对象，递归排序
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      value = sortedObjectByKeys(value)
    }
    sortedObj[key] = value
  }

  return sortedObj
}

export { sortedObjectByKeys }
