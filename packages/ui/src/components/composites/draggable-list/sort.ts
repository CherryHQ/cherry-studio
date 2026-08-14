/**
 * 用于 dnd 列表的元素重新排序方法。支持多元素"拖动"排序。
 * @template {T} 列表元素的类型
 * @param {T[]} list 要重新排序的列表
 * @param {number} sourceIndex 起始元素索引
 * @param {number} destIndex 目标元素索引
 * @param {number} [len=1] 要移动的元素数量，默认为 1
 * @returns {T[]} 重新排序后的列表
 */
export function droppableReorder<T>(list: T[], sourceIndex: number, destIndex: number, len: number = 1): T[] {
  const result = Array.from(list)
  const removed = result.splice(sourceIndex, len)

  if (sourceIndex < destIndex) {
    result.splice(destIndex - len + 1, 0, ...removed)
  } else {
    result.splice(destIndex, 0, ...removed)
  }
  return result
}
