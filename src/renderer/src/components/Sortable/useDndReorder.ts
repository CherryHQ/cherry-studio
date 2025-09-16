import { Key, useCallback, useMemo } from 'react'

interface UseDndReorderParams<T> {
  /** 原始的、完整的数据列表 */
  originalList: T[]
  /** 当前在界面上渲染的、可能被过滤的列表 */
  filteredList: T[]
  /** 用于更新原始列表状态的函数 */
  onUpdate: (newList: T[]) => void
  /** 用于从列表项中获取唯一ID的属性名或函数 */
  itemKey: keyof T | ((item: T) => Key)
}

/**
 * 增强拖拽排序能力，处理“过滤后列表”与“原始列表”的索引映射问题。
 *
 * @template T 列表项的类型
 * @param params - { originalList, filteredList, onUpdate, idKey }
 * @returns 返回可以直接传递给 Sortable 的 onSortEnd 回调
 */
export function useDndReorder<T>({ originalList, filteredList, onUpdate, itemKey }: UseDndReorderParams<T>) {
  const getId = useCallback(
    (item: T) => (typeof itemKey === 'function' ? itemKey(item) : (item[itemKey] as Key)),
    [itemKey]
  )

  // 创建从 item ID 到其在 *原始列表* 中索引的映射
  const itemIndexMap = useMemo(() => {
    const map = new Map<Key, number>()
    originalList.forEach((item, index) => {
      map.set(getId(item), index)
    })
    return map
  }, [originalList, getId])

  // 创建一个函数，将 *过滤后列表* 的视图索引转换为 *原始列表* 的数据索引
  const getItemKey = useCallback(
    (index: number): Key => {
      const item = filteredList[index]
      // 如果找不到item，返回视图索引兜底
      if (!item) return index

      const originalIndex = itemIndexMap.get(getId(item))
      return originalIndex ?? index
    },
    [filteredList, itemIndexMap, getId]
  )

  // 创建 onSortEnd 回调，封装了所有重排逻辑
  const onSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      // 使用 getItemKey 将视图索引转换为数据索引
      const sourceOriginalIndex = getItemKey(oldIndex) as number
      const destOriginalIndex = getItemKey(newIndex) as number

      // 如果索引转换失败，不进行任何操作
      if (sourceOriginalIndex === undefined || destOriginalIndex === undefined) {
        return
      }

      if (sourceOriginalIndex === destOriginalIndex) {
        return
      }

      // 操作原始列表的副本
      const newList = [...originalList]
      const [movedItem] = newList.splice(sourceOriginalIndex, 1)
      newList.splice(destOriginalIndex, 0, movedItem)

      // 调用外部更新函数
      onUpdate(newList)
    },
    [getItemKey, originalList, onUpdate]
  )

  return { onSortEnd, itemKey: getItemKey }
}
