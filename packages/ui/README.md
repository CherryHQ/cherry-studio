# @cherrystudio/ui

Cherry Studio UI 组件库 - 为 Cherry Studio 设计的 React 组件集合

## 特性

- 🎨 基于 Tailwind CSS 的现代化设计
- 📦 支持 ESM 和 CJS 格式
- 🔷 完整的 TypeScript 支持
- 🚀 可以作为 npm 包发布
- 🔧 开箱即用的常用 hooks 和工具函数

## 安装

```bash
# 安装组件库
npm install @cherrystudio/ui

# 安装必需的 peer dependencies
npm install @heroui/react framer-motion react react-dom tailwindcss
```

## 配置

### 1. Tailwind CSS v4 配置

本组件库使用 Tailwind CSS v4，配置方式已改变。在你的主 CSS 文件（如 `src/styles/tailwind.css`）中：

```css
@import 'tailwindcss';

/* 必须扫描组件库文件以提取类名 */
@source '../node_modules/@cherrystudio/ui/dist/**/*.{js,mjs}';

/* 你的应用源文件 */
@source './src/**/*.{js,ts,jsx,tsx}';

/*
 * 如果你的应用直接使用 HeroUI 组件，需要添加：
 * @source '../node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}';
 * @plugin '@heroui/react/plugin';
 */

/* 自定义主题配置（可选） */
@theme {
  /* 你的主题扩展 */
}
```

注意：Tailwind CSS v4 不再使用 `tailwind.config.js` 文件，所有配置都在 CSS 中完成。

### 2. Provider 配置

在你的 App 根组件中添加 HeroUI Provider：

```tsx
import { HeroUIProvider } from '@heroui/react'

function App() {
  return (
    <HeroUIProvider>
      {/* 你的应用内容 */}
    </HeroUIProvider>
  )
}
```

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

// 只导入 hooks
import { useDebounce, useLocalStorage } from '@cherrystudio/ui/hooks'

// 只导入工具函数
import { cn, formatFileSize } from '@cherrystudio/ui/utils'
```

## 开发

```bash
# 安装依赖
yarn install

# 开发模式（监听文件变化）
yarn dev

# 构建
yarn build

# 类型检查
yarn type-check

# 运行测试
yarn test
```

## 目录结构

```text
src/
├── components/          # React 组件
│   ├── Button/         # 按钮组件
│   ├── Input/          # 输入框组件
│   └── index.ts        # 组件导出
├── hooks/              # React Hooks
├── utils/              # 工具函数
├── types/              # 类型定义
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
