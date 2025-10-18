# Selector 组件

基于 HeroUI Select 封装的下拉选择组件，简化了 Set 和 Selection 的转换逻辑。

## 核心特性

- ✅ **类型安全**: 单选和多选自动推断回调类型
- ✅ **智能转换**: 自动处理 `Set<Key>` 和原始值的转换
- ✅ **HeroUI 风格**: 保持与 HeroUI 生态一致的 API
- ✅ **支持数字和字符串**: 泛型支持，自动识别值类型

## 基础用法

### 单选模式（默认）

```tsx
import { Selector } from '@cherrystudio/ui'
import { useState } from 'react'

function Example() {
  const [language, setLanguage] = useState('zh-CN')

  const languageOptions = [
    { label: '中文', value: 'zh-CN' },
    { label: 'English', value: 'en-US' },
    { label: '日本語', value: 'ja-JP' }
  ]

  return (
    <Selector
      selectedKeys={language}
      onSelectionChange={(value) => {
        // value 类型自动推断为 string
        setLanguage(value)
      }}
      items={languageOptions}
      placeholder="选择语言"
    />
  )
}
```

### 多选模式

```tsx
import { Selector } from '@cherrystudio/ui'
import { useState } from 'react'

function Example() {
  const [languages, setLanguages] = useState(['zh-CN', 'en-US'])

  const languageOptions = [
    { label: '中文', value: 'zh-CN' },
    { label: 'English', value: 'en-US' },
    { label: '日本語', value: 'ja-JP' },
    { label: 'Français', value: 'fr-FR' }
  ]

  return (
    <Selector
      selectionMode="multiple"
      selectedKeys={languages}
      onSelectionChange={(values) => {
        // values 类型自动推断为 string[]
        setLanguages(values)
      }}
      items={languageOptions}
      placeholder="选择语言"
    />
  )
}
```

### 数字类型值

```tsx
import { Selector } from '@cherrystudio/ui'

function Example() {
  const [priority, setPriority] = useState<number>(1)

  const priorityOptions = [
    { label: '低', value: 1 },
    { label: '中', value: 2 },
    { label: '高', value: 3 }
  ]

  return (
    <Selector<number>
      selectedKeys={priority}
      onSelectionChange={(value) => {
        // value 类型为 number
        setPriority(value)
      }}
      items={priorityOptions}
    />
  )
}
```

### 禁用选项

```tsx
const options = [
  { label: '选项 1', value: '1' },
  { label: '选项 2 (禁用)', value: '2', disabled: true },
  { label: '选项 3', value: '3' }
]

<Selector
  selectedKeys="1"
  onSelectionChange={handleChange}
  items={options}
/>
```

### 自定义 Label

```tsx
import { Flex } from '@cherrystudio/ui'

const options = [
  {
    label: (
      <Flex className="items-center gap-2">
        <span>🇨🇳</span>
        <span>中文</span>
      </Flex>
    ),
    value: 'zh-CN'
  },
  {
    label: (
      <Flex className="items-center gap-2">
        <span>🇺🇸</span>
        <span>English</span>
      </Flex>
    ),
    value: 'en-US'
  }
]

<Selector
  selectedKeys="zh-CN"
  onSelectionChange={handleChange}
  items={options}
/>
```

## API

### SelectorProps

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `items` | `SelectorItem<V>[]` | - | 必填，选项列表 |
| `selectedKeys` | `V` \| `V[]` | - | 受控的选中值（单选为单个值，多选为数组） |
| `onSelectionChange` | `(key: V) => void` \| `(keys: V[]) => void` | - | 选择变化回调（类型根据 selectionMode 自动推断） |
| `selectionMode` | `'single'` \| `'multiple'` | `'single'` | 选择模式 |
| `placeholder` | `string` | - | 占位文本 |
| `disabled` | `boolean` | `false` | 是否禁用 |
| `isRequired` | `boolean` | `false` | 是否必填 |
| `label` | `ReactNode` | - | 标签文本 |
| `description` | `ReactNode` | - | 描述文本 |
| `errorMessage` | `ReactNode` | - | 错误提示 |
| ...rest | `SelectProps` | - | 其他 HeroUI Select 属性 |

### SelectorItem

```tsx
interface SelectorItem<V = string | number> {
  label: string | ReactNode  // 显示文本或自定义内容
  value: V                   // 选项值
  disabled?: boolean         // 是否禁用
  [key: string]: any         // 其他自定义属性
}
```

## 类型安全

组件使用 TypeScript 条件类型，根据 `selectionMode` 自动推断回调类型：

```tsx
// 单选模式
<Selector
  selectionMode="single"  // 或省略（默认单选）
  selectedKeys={value}    // 类型: V
  onSelectionChange={(v) => ...}  // v 类型: V
/>

// 多选模式
<Selector
  selectionMode="multiple"
  selectedKeys={values}   // 类型: V[]
  onSelectionChange={(vs) => ...}  // vs 类型: V[]
/>
```

## 与 HeroUI Select 的区别

| 特性 | HeroUI Select | Selector (本组件) |
|------|---------------|------------------|
| `selectedKeys` | `Set<Key> \| 'all'` | `V` \| `V[]` (自动转换) |
| `onSelectionChange` | `(keys: Selection) => void` | `(key: V) => void` \| `(keys: V[]) => void` |
| 单选回调 | 返回 `Set` (需手动提取) | 直接返回单个值 |
| 多选回调 | 返回 `Set` (需转数组) | 直接返回数组 |
| 类型推断 | 无 | 根据 selectionMode 自动推断 |

## 最佳实践

### 1. 显式声明 selectionMode

虽然单选是默认模式，但建议显式声明以提高代码可读性：

```tsx
// ✅ 推荐
<Selector selectionMode="single" ... />

// ⚠️ 可以但不够清晰
<Selector ... />
```

### 2. 使用泛型指定值类型

当值类型为数字或联合类型时，使用泛型获得更好的类型提示：

```tsx
// ✅ 推荐
<Selector<number> selectedKeys={priority} ... />

// ✅ 推荐（联合类型）
type Status = 'pending' | 'approved' | 'rejected'
<Selector<Status> selectedKeys={status} ... />
```

### 3. 避免在渲染时创建 items

```tsx
// ❌ 不推荐（每次渲染都创建新数组）
<Selector items={[{ label: 'A', value: '1' }]} />

// ✅ 推荐（在组件外或使用 useMemo）
const items = [{ label: 'A', value: '1' }]
<Selector items={items} />
```

## 迁移指南

### 从 antd Select 迁移

```tsx
// antd Select
import { Select } from 'antd'

<Select
  value={value}
  onChange={(value) => onChange(value)}
  options={[
    { label: 'A', value: '1' },
    { label: 'B', value: '2' }
  ]}
/>

// 迁移到 Selector
import { Selector } from '@cherrystudio/ui'

<Selector
  selectedKeys={value}           // value → selectedKeys
  onSelectionChange={(value) => onChange(value)}  // onChange → onSelectionChange
  items={[                       // options → items
    { label: 'A', value: '1' },
    { label: 'B', value: '2' }
  ]}
/>
```

### 从旧版 Selector 迁移

```tsx
// 旧版 Selector (返回数组)
<Selector
  onSelectionChange={(values) => {
    const value = values[0]  // 需要手动提取
    onChange(value)
  }}
/>

// 新版 Selector (直接返回值)
<Selector
  selectionMode="single"
  onSelectionChange={(value) => {
    onChange(value)  // 直接使用
  }}
/>
```

## 常见问题

### Q: 为什么单选模式下还需要 selectedKeys 而不是 selectedKey？

A: 为了保持与 HeroUI API 命名的一致性，同时简化组件实现。组件内部会自动处理单个值和 Set 的转换。

### Q: 如何清空选择？

```tsx
// 单选模式
<Selector
  selectedKeys={value}
  onSelectionChange={setValue}
  isClearable  // 添加清空按钮
/>

// 或手动设置为 undefined
setValue(undefined)
```

### Q: 支持异步加载选项吗？

支持，配合 `isLoading` 属性使用：

```tsx
const [items, setItems] = useState([])
const [loading, setLoading] = useState(true)

useEffect(() => {
  fetchItems().then(data => {
    setItems(data)
    setLoading(false)
  })
}, [])

<Selector items={items} isLoading={loading} />
```