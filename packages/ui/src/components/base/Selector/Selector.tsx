import type { Selection } from '@heroui/react'
import { Select, SelectItem } from '@heroui/react'
import type { Key } from '@react-types/shared'
import { useMemo } from 'react'

import type { SelectorItem, SelectorProps } from './types'

const Selector = <T extends SelectorItem>(props: SelectorProps<T>) => {
  const { items, onSelectionChange, selectedKeys, selectionMode = 'single', children, ...rest } = props

  // 转换 selectedKeys: V | V[] | undefined → Set<Key> | undefined
  const heroUISelectedKeys = useMemo(() => {
    if (selectedKeys === undefined) return undefined

    if (selectionMode === 'multiple') {
      // 多选模式: V[] → Set<Key>
      return new Set((selectedKeys as T['value'][]).map((key) => String(key) as Key))
    } else {
      // 单选模式: V → Set<Key>
      return new Set([String(selectedKeys) as Key])
    }
  }, [selectedKeys, selectionMode])

  // 处理选择变化，转换 Selection → V | V[]
  const handleSelectionChange = (keys: Selection) => {
    if (!onSelectionChange) return

    if (keys === 'all') {
      // 如果是全选，返回所有非禁用项的值
      const allValues = items.filter((item) => !item.disabled).map((item) => item.value)
      if (selectionMode === 'multiple') {
        ;(onSelectionChange as (keys: T['value'][]) => void)(allValues)
      }
      return
    }

    // 转换 Set<Key> 为原始类型
    const keysArray = Array.from(keys).map((key) => {
      const strKey = String(key)
      // 尝试转换回数字类型（如果原始值是数字）
      const num = Number(strKey)
      return !isNaN(num) && items.some((item) => item.value === num) ? (num as T['value']) : (strKey as T['value'])
    })

    if (selectionMode === 'multiple') {
      // 多选模式: 返回数组
      ;(onSelectionChange as (keys: T['value'][]) => void)(keysArray)
    } else {
      // 单选模式: 返回单个值
      if (keysArray.length > 0) {
        ;(onSelectionChange as (key: T['value']) => void)(keysArray[0])
      }
    }
  }

  // 默认渲染函数
  const defaultRenderItem = (item: T) => (
    <SelectItem key={String(item.value)} textValue={item.label ? String(item.label) : String(item.value)}>
      {item.label ?? item.value}
    </SelectItem>
  )

  return (
    <Select
      {...rest}
      items={items}
      selectionMode={selectionMode}
      selectedKeys={heroUISelectedKeys as 'all' | Iterable<Key> | undefined}
      onSelectionChange={handleSelectionChange}>
      {children ?? defaultRenderItem}
    </Select>
  )
}

export default Selector
