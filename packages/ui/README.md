# @cherrystudio/ui

Cherry Studio UI 组件库 - 为 Cherry Studio 设计的 React 组件集合

## ✨ 特性

- 🎨 **设计系统**: 完整的 CherryStudio 设计令牌（17种颜色 × 11个色阶 + 语义化主题）
- 🌓 **Dark Mode**: 开箱即用的深色模式支持
- 🚀 **Tailwind v4**: 基于最新 Tailwind CSS v4 构建
- 📦 **灵活导入**: 2种样式导入方式，满足不同使用场景
- 🔷 **TypeScript**: 完整的类型定义和智能提示
- 🎯 **零冲突**: CSS 变量隔离，不覆盖用户主题

---

## 🚀 快速开始

### 安装

```bash
npm install @cherrystudio/ui
# peer dependencies
npm install framer-motion react react-dom tailwindcss
```

> 当前仓库内的推荐接入方式是通过包导出入口使用：
> `@cherrystudio/ui`
> `@cherrystudio/ui/components`
> `@cherrystudio/ui/icons`
> `@cherrystudio/ui/utils`
> `@cherrystudio/ui/styles/*`

### 两种使用方式

#### 方式 1：完整覆盖 ✨

使用完整的 CherryStudio 设计系统，所有 Tailwind 类名映射到设计系统。

```css
/* app.css */
@import '@cherrystudio/ui/styles/theme.css';
```

**特点**：

- ✅ 直接使用标准 Tailwind 类名（`bg-primary`、`bg-red-500`、`p-md`、`rounded-lg`）
- ✅ 所有颜色使用设计师定义的值
- ✅ 扩展的 Spacing 系统（`p-5xs` ~ `p-8xl`，共 16 个语义化尺寸）
- ✅ 扩展的 Radius 系统（`rounded-4xs` ~ `rounded-3xl`，共 11 个圆角）
- ⚠️ 会完全覆盖 Tailwind 默认主题

**示例**：

```tsx
<Button className="bg-primary text-red-500 p-md rounded-lg">
  {/* bg-primary → 品牌色（lime-500） */}
  {/* text-red-500 → 设计师定义的红色 */}
  {/* p-md → 2.5rem（spacing-md） */}
  {/* rounded-lg → 2.5rem（radius-lg） */}
</Button>

{/* 扩展的工具类 */}
<div className="p-5xs">最小间距 (0.5rem)</div>
<div className="p-xs">超小间距 (1rem)</div>
<div className="p-sm">小间距 (1.5rem)</div>
<div className="p-md">中等间距 (2.5rem)</div>
<div className="p-lg">大间距 (3.5rem)</div>
<div className="p-xl">超大间距 (5rem)</div>
<div className="p-8xl">最大间距 (15rem)</div>

<div className="rounded-4xs">最小圆角 (0.25rem)</div>
<div className="rounded-xs">小圆角 (1rem)</div>
<div className="rounded-md">中等圆角 (2rem)</div>
<div className="rounded-xl">大圆角 (3rem)</div>
<div className="rounded-round">完全圆角 (999px)</div>
```

#### 方式 2：选择性覆盖 🎯

只导入设计令牌（CSS 变量），手动选择要覆盖的部分。

```css
/* app.css */
@import 'tailwindcss';
@import '@cherrystudio/ui/styles/tokens.css';

/* 只使用部分设计系统 */
@theme {
  --color-primary: var(--cs-primary);     /* 使用 CS 的主色 */
  --color-red-500: oklch(...);            /* 使用自己的红色 */
  --spacing-md: var(--cs-size-md);        /* 使用 CS 的间距 */
  --radius-lg: 1rem;                      /* 使用自己的圆角 */
}
```

**特点**：

- ✅ 不覆盖任何 Tailwind 默认主题
- ✅ 通过 CSS 变量访问所有设计令牌（`var(--cs-primary)`、`var(--cs-red-500)`）
- ✅ 精细控制哪些使用 CS、哪些保持原样
- ✅ 适合有自己设计系统但想借用部分 CS 设计令牌的场景

**示例**：

```tsx
{/* 通过 CSS 变量使用 CS 设计令牌 */}
<button style={{ backgroundColor: 'var(--cs-primary)' }}>
  使用 CherryStudio 品牌色
</button>

{/* 保持原有的 Tailwind 类名不受影响 */}
<div className="bg-red-500">
  使用 Tailwind 默认的红色
</div>

{/* 可用的 CSS 变量 */}
<div style={{
  color: 'var(--cs-primary)',           // 品牌色
  backgroundColor: 'var(--cs-red-500)', // 红色-500
  padding: 'var(--cs-size-md)',         // 间距
  borderRadius: 'var(--cs-radius-lg)'   // 圆角
}} />
```

### CSS 变量规则

为避免 token、theme 和 runtime override 混用，建议遵循以下约定：

1. `--cs-*` 是 design token namespace，来源于 `tokens/*`
2. `--color-*`、`--radius-*`、`--font-*` 是公开 theme contract，默认给组件和外部消费方使用
3. `--cs-theme-*` 是 runtime override input，只用于运行时覆写入口
4. `--primary` 这类变量属于 compatibility alias，只为兼容 shadcn / Tailwind 生态保留，不作为新代码首选

默认消费规则：

1. 普通业务包默认依赖 `@cherrystudio/ui/styles/theme.css`
2. 普通业务包优先使用 `--color-*` 等公开 contract，不直接绑定 `--cs-brand-500` 这类 primitive token
3. 只有明确需要 token 层能力的设计系统配套包，才建议直接依赖 `@cherrystudio/ui/styles/tokens.css`
4. 运行时主题逻辑只写 `--cs-theme-*` 这类受控入口变量，不直接写派生后的 `--color-*` 结果变量

## 使用

### 基础组件

```tsx
import { Button, Input } from '@cherrystudio/ui'

function App() {
  return (
    <div>
      <Button variant="primary" size="md">
        点击我
      </Button>
      <Input
        type="text"
        placeholder="请输入内容"
        onChange={(value) => console.log(value)}
      />
    </div>
  )
}
```

### 分模块导入

```tsx
// 只导入组件
import { Button } from '@cherrystudio/ui/components'

// 只导入工具函数
import { cn, formatFileSize } from '@cherrystudio/ui/utils'
```

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式（监听文件变化）
pnpm dev

# 构建
pnpm build

# 类型检查
pnpm type-check

# 运行测试
pnpm test
```

## 目录结构

```text
src/
├── components/
│   ├── primitives/     # Primitive components
│   ├── composites/     # Composite components
│   ├── icons/          # Icon runtime exports and catalogs
│   └── index.ts
├── hooks/              # React Hooks
├── lib/                # Internal utilities
├── styles/             # Tokens and theme entry files
├── utils/              # 工具函数
└── index.ts            # 主入口文件
```

## 组件列表

### Button 按钮

支持多种变体和尺寸的按钮组件。

**Props:**

- `variant`: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
- `size`: 'sm' | 'md' | 'lg'
- `loading`: boolean
- `fullWidth`: boolean
- `leftIcon` / `rightIcon`: React.ReactNode

### Input 输入框

带有错误处理和密码显示切换的输入框组件。

**Props:**

- `type`: 'text' | 'password' | 'email' | 'number'
- `error`: boolean
- `errorMessage`: string
- `onChange`: (value: string) => void

## Hooks

### useDebounce

防抖处理，延迟执行状态更新。

### useLocalStorage

本地存储的 React Hook 封装。

### useClickOutside

检测点击元素外部区域。

### useCopyToClipboard

复制文本到剪贴板。

## 工具函数

### cn(...inputs)

基于 clsx 的类名合并工具，支持条件类名。

### formatFileSize(bytes)

格式化文件大小显示。

### debounce(func, delay)

防抖函数。

### throttle(func, delay)

节流函数。

## 许可证

MIT
