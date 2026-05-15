import type { Key } from 'react'
import { useCallback, useMemo } from 'react'

import { reorderVisibleSubset } from '../components/composites/ReorderableList/reorderVisibleSubset'

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
 * 增强拖拽排序能力，处理"过滤后列表"与"原始列表"的索引映射问题。
 *
 * 底层算法委托给 {@link reorderVisibleSubset}（同一个 UI 包里的纯函数实现），
 * 这里只负责把视图层的 `{ oldIndex, newIndex }` 适配进去 + 通过 `useMemo` /
 * `useCallback` 给视图侧的 `itemKey(index)` 提供稳定引用。两份算法实现的
 * 历史复刻在 PR #14631 review #4287764522 (S9) 被指出，由此合并。
 *
 * @template T 列表项的类型
 * @param params - { originalList, filteredList, onUpdate, itemKey }
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

  // 将 *过滤后列表* 的视图索引转换为 *原始列表* 的数据索引（itemKey 兜底用）
  const getItemKey = useCallback(
    (index: number): Key => {
      const item = filteredList[index]
      if (!item) return index

      const originalIndex = itemIndexMap.get(getId(item))
      return originalIndex ?? index
    },
    [filteredList, itemIndexMap, getId]
  )

  // 重排逻辑委托给 reorderVisibleSubset，保持一份算法实现。
  const onSortEnd = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const nextList = reorderVisibleSubset({
        items: originalList,
        visibleItems: filteredList,
        fromIndex: oldIndex,
        toIndex: newIndex,
        getId: (item) => getId(item) as string | number
      })

      if (nextList !== originalList) {
        onUpdate(nextList)
      }
    },
    [filteredList, getId, onUpdate, originalList]
  )

  return { onSortEnd, itemKey: getItemKey }
}
