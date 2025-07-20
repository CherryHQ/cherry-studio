'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.sortedObjectByKeys = sortedObjectByKeys
// https://github.com/Gudahtt/prettier-plugin-sort-json/blob/main/src/index.ts
/**
 * Lexical sort function for strings, meant to be used as the sort
 * function for `Array.prototype.sort`.
 *
 * @param a - First element to compare.
 * @param b - Second element to compare.
 * @returns A number indicating which element should come first.
 */
function lexicalSort(a, b) {
  if (a > b) {
    return 1
  }
  if (a < b) {
    return -1
  }
  return 0
}
/**
 * 对对象的键按照字典序进行排序（支持嵌套对象）
 * @param obj 需要排序的对象
 * @returns 返回排序后的新对象
 */
function sortedObjectByKeys(obj) {
  var sortedKeys = Object.keys(obj).sort(lexicalSort)
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
