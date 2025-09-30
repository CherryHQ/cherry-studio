import { Autocomplete, AutocompleteItem } from '@heroui/react'
import type { Key } from '@react-types/shared'
import { useMemo } from 'react'

import type { SearchableSelectorItem, SearchableSelectorProps } from './types'

const SearchableSelector = <T extends SearchableSelectorItem>(props: SearchableSelectorProps<T>) => {
  const { items, onSelectionChange, selectedKeys, selectionMode = 'single', children, ...rest } = props

  // 转换 selectedKeys: V | V[] → Key | undefined (Autocomplete 只支持单选)
  const autocompleteSelectedKey = useMemo(() => {
    if (selectedKeys === undefined) return undefined

    if (selectionMode === 'multiple') {
      // Autocomplete 不支持多选，取第一个
      const keys = selectedKeys as T['value'][]
      return keys.length > 0 ? String(keys[0]) : undefined
    } else {
      return String(selectedKeys)
    }
  }, [selectedKeys, selectionMode])

  // 处理选择变化
  const handleSelectionChange = (key: Key | null) => {
    if (!onSelectionChange || key === null) return

    const strKey = String(key)
    // 尝试转换回数字类型
    const num = Number(strKey)
    const value = !isNaN(num) && items.some((item) => item.value === num) ? (num as T['value']) : (strKey as T['value'])

    if (selectionMode === 'multiple') {
      // 多选模式: 返回数组 (Autocomplete 只支持单选，这里简化处理)
      ;(onSelectionChange as (keys: T['value'][]) => void)([value])
    } else {
      // 单选模式: 返回单个值
      ;(onSelectionChange as (key: T['value']) => void)(value)
    }
  }

  // 默认渲染函数
  const defaultRenderItem = (item: T) => (
    <AutocompleteItem key={String(item.value)} textValue={item.label ? String(item.label) : String(item.value)}>
      {item.label ?? item.value}
    </AutocompleteItem>
  )

  return (
    <Autocomplete
      {...rest}
      items={items}
      selectedKey={autocompleteSelectedKey}
      onSelectionChange={handleSelectionChange}
      allowsCustomValue={false}>
      {children ?? defaultRenderItem}
    </Autocomplete>
  )
}

export default SearchableSelector
