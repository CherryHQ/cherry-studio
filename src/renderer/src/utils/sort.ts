/**
 * 用于 dnd 列表的元素重新排序方法。
 * @template T 列表元素的类型
 * @param list 要重新排序的列表
 * @param startIndex 开始索引
 * @param endIndex 结束索引
 * @param len 要移动的元素数量，默认为 1
 * @returns T[] 重新排序后的列表
 */
export function droppableReorder<T>(list: T[], startIndex: number, endIndex: number, len = 1) {
  const result = Array.from(list)
  const removed = result.splice(startIndex, len)
  result.splice(endIndex, 0, ...removed)
  return result
}
