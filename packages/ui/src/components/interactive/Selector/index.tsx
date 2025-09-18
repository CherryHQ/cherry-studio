import type { Selection, SelectProps } from '@heroui/react'
import { Select, SelectItem } from '@heroui/react'
import type { ReactNode } from 'react'

interface SelectorItem<V = string | number> {
  label: string | ReactNode
  value: V
  disabled?: boolean
  [key: string]: any
}

interface SelectorProps<V = string | number> extends Omit<SelectProps, 'children' | 'onSelectionChange'> {
  items: SelectorItem<V>[]
  onSelectionChange?: (keys: V[]) => void
}

const Selector = <V extends string | number>({ items, onSelectionChange, ...rest }: SelectorProps<V>) => {
  // 处理选择变化，转换 Set 为数组
  const handleSelectionChange = (keys: Selection) => {
    if (!onSelectionChange) return
    if (keys === 'all') {
      // 如果是全选，返回所有非禁用项的值
      const allValues = items.filter((item) => !item.disabled).map((item) => item.value)
      onSelectionChange(allValues)
      return
    }

    // 转换 Set<Key> 为原始类型数组
    const keysArray = Array.from(keys).map((key) => {
      const strKey = String(key)
      // 尝试转换回数字类型（如果原始值是数字）
      const num = Number(strKey)
      return !isNaN(num) && items.some((item) => item.value === num) ? num : strKey
    }) as V[]

    onSelectionChange(keysArray)
  }

  return (
    <Select
      {...rest}
      label={<label className="hidden">Select</label>}
      items={items}
      onSelectionChange={handleSelectionChange}>
      {({ value, label, ...restItem }: SelectorItem<V>) => (
        <SelectItem {...restItem} key={value} title={String(label)}>
          {label}
        </SelectItem>
      )}
    </Select>
  )
}

export default Selector
export type { SelectorItem, SelectorProps }
