import type { AutocompleteProps, SelectProps } from '@heroui/react'
import type { ReactElement, ReactNode } from 'react'

interface SelectorItem<V = string | number> {
  label?: string | ReactNode
  value: V
  disabled?: boolean
  [key: string]: any
}

// 自定义渲染函数类型
type SelectorRenderItem<T> = (item: T) => ReactElement

// 单选模式的 Props
interface SingleSelectorProps<T extends SelectorItem = SelectorItem>
  extends Omit<SelectProps<T>, 'children' | 'onSelectionChange' | 'selectedKeys' | 'selectionMode'> {
  items: T[]
  selectionMode?: 'single'
  selectedKeys?: T['value']
  onSelectionChange?: (key: T['value']) => void
  children?: SelectorRenderItem<T>
}

// 多选模式的 Props
interface MultipleSelectorProps<T extends SelectorItem = SelectorItem>
  extends Omit<SelectProps<T>, 'children' | 'onSelectionChange' | 'selectedKeys' | 'selectionMode'> {
  items: T[]
  selectionMode: 'multiple'
  selectedKeys?: T['value'][]
  onSelectionChange?: (keys: T['value'][]) => void
  children?: SelectorRenderItem<T>
}

type SelectorProps<T extends SelectorItem = SelectorItem> = SingleSelectorProps<T> | MultipleSelectorProps<T>

interface SearchableSelectorItem<V = string | number> {
  label?: string | ReactNode
  value: V
  disabled?: boolean
  [key: string]: any
}

// 自定义渲染函数类型
type SearchableRenderItem<T> = (item: T) => ReactElement

// 单选模式的 Props
interface SingleSearchableSelectorProps<T extends SearchableSelectorItem = SearchableSelectorItem>
  extends Omit<AutocompleteProps<T>, 'children' | 'onSelectionChange' | 'selectedKey' | 'selectionMode'> {
  items: T[]
  selectionMode?: 'single'
  selectedKeys?: T['value']
  onSelectionChange?: (key: T['value']) => void
  children?: SearchableRenderItem<T>
}

// 多选模式的 Props
interface MultipleSearchableSelectorProps<T extends SearchableSelectorItem = SearchableSelectorItem>
  extends Omit<AutocompleteProps<T>, 'children' | 'onSelectionChange' | 'selectedKey' | 'selectionMode'> {
  items: T[]
  selectionMode: 'multiple'
  selectedKeys?: T['value'][]
  onSelectionChange?: (keys: T['value'][]) => void
  children?: SearchableRenderItem<T>
}

type SearchableSelectorProps<T extends SearchableSelectorItem = SearchableSelectorItem> =
  | SingleSearchableSelectorProps<T>
  | MultipleSearchableSelectorProps<T>

export type {
  MultipleSearchableSelectorProps,
  MultipleSelectorProps,
  SearchableSelectorItem,
  SearchableSelectorProps,
  SelectorItem,
  SelectorProps,
  SingleSearchableSelectorProps,
  SingleSelectorProps
}
