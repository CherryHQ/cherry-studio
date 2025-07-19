'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.sortedObjectByKeys = sortedObjectByKeys
/**
 * 对对象的键按照字典序进行排序（支持嵌套对象）
 * @param obj 需要排序的对象
 * @returns 返回排序后的新对象
 */
function sortedObjectByKeys(obj) {
  var sortedKeys = Object.keys(obj).sort(function (a, b) {
    return a.localeCompare(b)
  })
  var sortedObj = {}
  for (var _i = 0, sortedKeys_1 = sortedKeys; _i < sortedKeys_1.length; _i++) {
    var key = sortedKeys_1[_i]
    var value = obj[key]
    // 如果值是对象，递归排序
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      value = sortedObjectByKeys(value)
    }
    sortedObj[key] = value
  }
  return sortedObj
}
