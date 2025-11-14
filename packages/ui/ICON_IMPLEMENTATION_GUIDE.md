# Cherry Studio UI - 彩色 Logo 图标系统实施方案

> 借鉴 Lucide IconNode 架构，为 Cherry Studio UI 库构建专门支持彩色品牌 Logo 的轻量级图标系统

## 📋 目录

- [项目概述](#项目概述)
- [架构设计](#架构设计)
- [核心概念](#核心概念)
- [实施步骤](#实施步骤)
- [使用示例](#使用示例)
- [工作流程](#工作流程)
- [常见问题](#常见问题)

---

## 项目概述

### 背景

Cherry Studio 是一个 Electron + React 的 monorepo 项目，主包通过 Vite alias 直接引用 UI 包的源码。我们需要为 UI 库添加 40+ 个 **彩色品牌 Logo 图标**（如 Anthropic、OpenAI、DeepSeek、Cohere 等）。

### 图标特点

这些图标与传统线性图标（如 Lucide）有本质区别：

| 特征 | 传统线性图标 | 我们的彩色 Logo |
|------|------------|----------------|
| **颜色方式** | `stroke="currentColor"` | `fill="#3F3FAA"` 等固定颜色 |
| **结构** | 简单 path | 复杂嵌套 (`<g>`, `<clipPath>`, `<defs>`) |
| **样式控制** | 可动态改变颜色/描边 | 必须保留原始颜色 |
| **使用场景** | UI 通用图标 | 品牌标识 |

### 方案特点

- ✅ **保留原色**：完整保留 SVG 中的所有 fill 颜色
- ✅ **支持嵌套**：处理复杂的 `<g>`、`<clipPath>`、`<defs>` 结构
- ✅ **借鉴 Lucide**：采用 IconNode 数据结构，工厂模式创建组件
- ✅ **轻量级实现**：简化构建流程，无需复杂工具链
- ✅ **源码直连**：主包通过 alias 直接使用源码，支持热更新
- ✅ **TypeScript 支持**：完整的类型推导和类型安全
- ✅ **Tailwind 友好**：完美支持 Tailwind CSS 样式
- ✅ **自动化生成**：一键从 SVG 生成 React 组件

### 技术栈

- React 19
- TypeScript 5.8
- SVGO 3.0 (SVG 优化)
- Tailwind CSS 4.1

---

## 架构设计

### 目录结构

```
cherry-studio/
├── packages/ui/
│   ├── icons/                          # ① 源 SVG 文件目录
│   │   ├── arrow-right.svg
│   │   ├── check.svg
│   │   ├── close.svg
│   │   └── ... (40+ SVG 文件)
│   │
│   ├── scripts/
│   │   └── generate-icons.ts           # ② 生成脚本
│   │
│   ├── src/
│   │   └── components/
│   │       └── icons/
│   │           ├── Icon.tsx            # ③ 基础组件
│   │           ├── generated/          # ④ 自动生成的图标组件
│   │           │   ├── ArrowRight.tsx
│   │           │   ├── Check.tsx
│   │           │   ├── Close.tsx
│   │           │   └── index.ts
│   │           └── index.ts            # ⑤ 统一导出
│   │
│   └── package.json
│
└── src/renderer/src/                   # ⑦ 主包使用
    └── components/
        └── YourComponent.tsx
```

### 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                        用户层                                 │
│  <ArrowRight size={24} className="text-blue-500" />         │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                     具体图标组件层                            │
│  ArrowRight = createIcon('ArrowRight', iconNode)            │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                      工厂函数层                               │
│  createIcon(name, iconNode) → IconComponent                 │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                      基础组件层                               │
│  Icon: 渲染 SVG，处理 props，映射 IconNode                   │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                       数据层                                  │
│  IconNode: [['path', { d: '...' }], ['circle', {...}]]     │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心概念

### 1. IconNode 数据结构（支持嵌套）

借鉴 Lucide 的核心设计，扩展为支持嵌套结构的数组格式：

```typescript
type IconNode = [
  tag: string,                           // SVG 元素标签名
  attrs: Record<string, string | number>, // 元素属性
  children?: IconNode                     // 子元素（支持嵌套）
][];

// 简单示例（平面结构）
const simpleIcon: IconNode = [
  ['path', { d: 'M5 12h14', fill: '#000' }],
  ['circle', { cx: '12', cy: '12', r: '10', fill: '#fff' }]
];

// 复杂示例（嵌套结构，品牌 Logo 常见）
const complexIcon: IconNode = [
  ['g', { clipPath: 'url(#clip0)' }, [
    ['path', { d: 'M18 0H6...', fill: '#CA9F7B' }],
    ['path', { d: 'M15.38 6.43...', fill: '#191918' }]
  ]],
  ['defs', {}, [
    ['clipPath', { id: 'clip0' }, [
      ['rect', { width: '24', height: '24', fill: 'white' }]
    ]]
  ]]
];
```

**优势：**
- 📦 体积极小（只存储数据，不存储模板）
- 🔄 框架无关（可复用于 Vue/Svelte 等）
- ⚡ 渲染快速（直接 createElement，无需解析）
- 🎨 **保留原色**（完整保留 fill 等样式属性）
- 🌲 **支持嵌套**（处理复杂的品牌 Logo 结构）

### 2. 工厂模式

使用 `createIcon` 函数统一创建图标组件：

```typescript
export function createIcon(
  componentName: string,
  iconNode: IconNode
) {
  const IconComponent = forwardRef<SVGSVGElement, IconProps>(
    (props, ref) => {
      return <Icon ref={ref} iconNode={iconNode} {...props} />;
    }
  );

  IconComponent.displayName = componentName;
  return IconComponent;
}
```

**优势：**
- ✅ 代码复用（40+ 图标共享同一套逻辑）
- ✅ 统一行为（所有图标的 props 处理完全一致）
- ✅ 易于维护（修改一处，全部更新）

### 3. 自动化生成

从 SVG 到 React 组件的自动化流程：

```
SVG 文件 → SVGO 优化 → 正则解析 → IconNode → 组件代码 → 写入文件
```

---

## 实施步骤

### 步骤 1：创建基础 Icon 组件

创建文件：`packages/ui/src/components/icons/Icon.tsx`

```tsx
import React, { forwardRef, memo } from 'react';
import { cn } from '@/utils';

/**
 * IconNode 数据结构（借鉴 lucide，扩展支持嵌套）
 * 格式: [标签名, 属性对象, 子元素（可选）]
 */
export type IconNode = [
  tag: string,
  attrs: Record<string, string | number>,
  children?: IconNode
][];

/**
 * Icon 组件的 Props（专为彩色 Logo 优化）
 */
export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** 图标大小，支持数字（px）或字符串（如 "1rem"） */
  size?: number | string;
  /** 自定义类名 */
  className?: string;
  /** 子元素 */
  children?: React.ReactNode;
}

/**
 * Icon 组件内部 Props（包含 iconNode）
 */
interface IconComponentProps extends IconProps {
  iconNode: IconNode;
  /** 图标名称（用于 className） */
  iconName?: string;
}

/**
 * 递归渲染 IconNode（支持嵌套结构）
 */
function renderNodes(nodes: IconNode, keyPrefix = ''): React.ReactNode[] {
  return nodes.map((node, index) => {
    const [tag, attrs, children] = node;
    const key = `${keyPrefix}${index}`;

    // 如果有子元素，递归渲染
    const childElements = children ? renderNodes(children, `${key}-`) : undefined;

    return React.createElement(
      tag,
      { key, ...attrs },
      childElements
    );
  });
}

/**
 * 基础 Icon 组件（专为彩色品牌 Logo 设计）
 * - 保留 SVG 原始颜色（不强制 fill/stroke）
 * - 支持嵌套结构（g, clipPath, defs 等）
 * - 只控制 size 和 className
 */
export const Icon = memo(
  forwardRef<SVGSVGElement, IconComponentProps>(
    (
      {
        iconNode,
        iconName,
        size = 24,
        className,
        children,
        ...props
      },
      ref
    ) => {
      return (
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className={cn(
            'inline-block flex-shrink-0',
            iconName && `icon-${iconName}`,
            className
          )}
          {...props}
        >
          {/* 递归渲染 IconNode（支持嵌套） */}
          {renderNodes(iconNode)}
          {children}
        </svg>
      );
    }
  )
);

Icon.displayName = 'Icon';

/**
 * 工厂函数：创建具体的图标组件
 * @param componentName - 组件名称（PascalCase）
 * @param iconNode - 图标数据
 * @returns 图标组件
 */
export function createIcon(
  componentName: string,
  iconNode: IconNode
) {
  const IconComponent = forwardRef<SVGSVGElement, IconProps>(
    (props, ref) => {
      return (
        <Icon
          ref={ref}
          iconNode={iconNode}
          iconName={componentName}
          {...props}
        />
      );
    }
  );

  IconComponent.displayName = componentName;
  return IconComponent;
}
```

---

### 步骤 2：创建生成脚本

创建文件：`packages/ui/scripts/generate-icons.ts`

```typescript
import fs from 'fs/promises';
import path from 'path';
import { optimize } from 'svgo';

const ICONS_DIR = path.join(__dirname, '../icons');
const OUTPUT_DIR = path.join(__dirname, '../src/components/icons/generated');

// SVGO 优化配置（专为彩色 Logo 优化）
const svgoConfig = {
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // 保留 viewBox（必须！）
          removeViewBox: false,
          // 不转换为 path（保持原始形状）
          convertShapeToPath: false,
          // 不移除隐藏元素（可能包含 defs）
          removeHiddenElems: false,
        },
      },
    },
    {
      // 只移除 width 和 height（保留所有颜色和样式）
      name: 'removeAttrs',
      params: {
        attrs: '(width|height)',
      },
    },
  ],
};

/**
 * 转换命名：kebab-case → PascalCase
 * 例: arrow-right → ArrowRight, 302ai → Ai302
 */
function toPascalCase(str: string): string {
  // 处理数字开头的情况（如 302ai）
  if (/^\d/.test(str)) {
    // 提取开头的数字和后续部分
    const match = str.match(/^(\d+)(.*)$/);
    if (match) {
      const [, numbers, rest] = match;
      // 将数字放在后面：302ai → Ai302
      str = rest + numbers;
    }
  }

  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * 解析 SVG 为 IconNode 格式（支持嵌套结构）
 * 使用 svgson 库来可靠地处理复杂的嵌套结构
 */
async function parseSvg(svgContent: string): Promise<string> {
  const { parse } = await import('svgson');

  // 1. SVGO 优化
  const optimized = optimize(svgContent, svgoConfig);
  const svgString = optimized.data;

  // 2. 使用 svgson 解析为 AST
  const ast = await parse(svgString);

  // 3. 转换为 IconNode 格式
  const iconNode = convertToIconNode(ast.children);

  // 4. 格式化为 TypeScript 代码
  return formatIconNode(iconNode);
}

/**
 * 将 svgson AST 转换为 IconNode 格式
 */
function convertToIconNode(nodes: any[]): any[] {
  return nodes.map(node => {
    const { name, attributes, children } = node;

    if (children && children.length > 0) {
      const childNodes = convertToIconNode(children);
      return [name, attributes, childNodes];
    } else {
      return [name, attributes];
    }
  });
}

/**
 * 格式化 IconNode 为 TypeScript 代码
 */
function formatIconNode(nodes: any[], indent = 0): string {
  const indentStr = '  '.repeat(indent + 1);

  const items = nodes.map(node => {
    const [tag, attrs, children] = node;

    if (children) {
      const childrenStr = formatIconNode(children, indent + 1);
      return `${indentStr}['${tag}', ${JSON.stringify(attrs)}, ${childrenStr}]`;
    } else {
      return `${indentStr}['${tag}', ${JSON.stringify(attrs)}]`;
    }
  });

  if (indent === 0) {
    return `[\n${items.join(',\n')}\n]`;
  } else {
    return `[\n${items.join(',\n')}\n${'  '.repeat(indent)}]`;
  }
}

/**
 * 生成单个图标组件文件
 */
async function generateIconComponent(
  iconName: string,
  iconNode: string
): Promise<string> {
  const componentName = toPascalCase(iconName);

  return `import { forwardRef } from 'react';
import { createIcon, type IconProps } from '../Icon';
import type { IconNode } from '../Icon';

const iconNode: IconNode = ${iconNode};

/**
 * ${componentName} icon component
 *
 * @example
 * <${componentName} size={24} color="red" />
 * <${componentName} className="text-blue-500" />
 */
export const ${componentName} = createIcon('${componentName}', iconNode);

export default ${componentName};
`;
}

/**
 * 主函数：生成所有图标
 */
async function generateIcons() {
  console.log('🚀 开始生成图标组件...\n');

  try {
    // 检查 icons 目录是否存在
    try {
      await fs.access(ICONS_DIR);
    } catch {
      console.error(`❌ 错误: 找不到 icons 目录: ${ICONS_DIR}`);
      console.log(`💡 提示: 请创建 ${ICONS_DIR} 目录并放入 SVG 文件`);
      process.exit(1);
    }

    // 确保输出目录存在
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // 读取所有 SVG 文件
    const files = await fs.readdir(ICONS_DIR);
    const svgFiles = files.filter(f => f.endsWith('.svg'));

    if (svgFiles.length === 0) {
      console.warn(`⚠️  警告: ${ICONS_DIR} 目录中没有找到 SVG 文件`);
      process.exit(0);
    }

    console.log(`📁 找到 ${svgFiles.length} 个 SVG 文件\n`);

    const exports: string[] = [];
    let successCount = 0;
    let errorCount = 0;

    // 处理每个 SVG 文件
    for (const file of svgFiles) {
      const iconName = file.replace('.svg', '');
      const componentName = toPascalCase(iconName);

      try {
        console.log(`⚙️  处理: ${iconName}`);

        // 读取 SVG 内容
        const svgPath = path.join(ICONS_DIR, file);
        const svgContent = await fs.readFile(svgPath, 'utf-8');

        // 解析为 IconNode
        const iconNode = await parseSvg(svgContent);

        // 生成组件代码
        const componentCode = await generateIconComponent(iconName, iconNode);

        // 写入文件
        const outputPath = path.join(OUTPUT_DIR, `${componentName}.tsx`);
        await fs.writeFile(outputPath, componentCode, 'utf-8');

        // 收集导出语句
        exports.push(`export { ${componentName} } from './${componentName}';`);
        successCount++;
      } catch (error) {
        console.error(`❌ 处理 ${iconName} 失败:`, error);
        errorCount++;
      }
    }

    // 生成 index.ts（统一导出）
    const indexContent = `/**
 * 自动生成的图标导出文件
 * 请勿手动编辑
 *
 * 生成时间: ${new Date().toISOString()}
 * 图标数量: ${successCount}
 */

${exports.sort().join('\n')}
`;

    await fs.writeFile(
      path.join(OUTPUT_DIR, 'index.ts'),
      indexContent,
      'utf-8'
    );

    // 输出结果
    console.log(`\n✅ 成功生成 ${successCount} 个图标组件!`);
    if (errorCount > 0) {
      console.log(`⚠️  失败 ${errorCount} 个图标`);
    }
    console.log(`📦 输出目录: ${OUTPUT_DIR}`);
  } catch (error) {
    console.error('\n❌ 生成过程发生错误:', error);
    process.exit(1);
  }
}

// 执行生成
generateIcons();
```

---

### 步骤 3：更新 package.json

在 `packages/ui/package.json` 中添加：

```json
{
  "scripts": {
    "generate:icons": "tsx scripts/generate-icons.ts",
    "build": "pnpm generate:icons && tsdown",
    "dev": "tsc -w"
  },
  "devDependencies": {
    "svgo": "^3.0.0",
    "svgson": "^5.3.1",
    "tsx": "^4.20.5"
  }
}
```

安装依赖：

```bash
cd packages/ui
pnpm add -D svgo svgson tsx
```

---

### 步骤 4：创建统一导出

创建文件：`packages/ui/src/components/icons/index.ts`

```typescript
/**
 * Icons 模块统一导出
 */

// 导出基础组件和类型
export { Icon, createIcon, type IconProps, type IconNode } from './Icon';

// 导出所有生成的图标
export * from './generated';
```

---

### 步骤 5：更新主导出文件

在 `packages/ui/src/components/index.ts` 中添加：

```typescript
// Icons
export * from './icons';
```

---

### 步骤 6：配置子路径导出（推荐）

为了支持 `@cherrystudio/ui/icons` 导入路径，需要在 `package.json` 中配置 `exports` 字段：

```json
{
  "name": "@cherrystudio/ui",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/components/index.ts",
      "types": "./src/components/index.ts"
    },
    "./icons": {
      "import": "./src/components/icons/index.ts",
      "types": "./src/components/icons/index.ts"
    }
  }
}
```

**同时更新主包的 Vite 配置**（`electron.vite.config.ts`）：

```typescript
export default defineConfig({
  resolve: {
    alias: {
      '@cherrystudio/ui': resolve('packages/ui/src/components'),
      '@cherrystudio/ui/icons': resolve('packages/ui/src/components/icons'),
    }
  }
});
```

这样你就可以使用两种导入方式：

```tsx
// 推荐：从 icons 子路径导入（84个图标）
import { Anthropic, Deepseek } from '@cherrystudio/ui/icons';

// 兼容：从主包导入
import { Anthropic, Deepseek } from '@cherrystudio/ui';
```

---

### 步骤 7：创建 icons 目录

```bash
cd packages/ui
mkdir icons
```

将你的 84 个 SVG 文件放入 `icons/` 目录。

---

## 使用示例

### 基础用法（彩色品牌 Logo）

```tsx
// 推荐：从 icons 子路径导入（84个图标，语义更清晰）
import { Anthropic, Deepseek, Cohere, Ai302 } from '@cherrystudio/ui/icons';

// 也可以：从主包导入（兼容方式）
// import { Anthropic, Deepseek } from '@cherrystudio/ui';

export function BasicExample() {
  return (
    <div className="flex gap-4 items-center">
      {/* 默认大小（24px） */}
      <Anthropic />

      {/* 自定义大小 */}
      <Deepseek size={32} />
      <Cohere size={48} />

      {/* 使用字符串大小 */}
      <Ai302 size="2rem" />
    </div>
  );
}
```

### Tailwind CSS 集成

```tsx
import { Anthropic, Deepseek } from '@cherrystudio/ui/icons';

export function TailwindExample() {
  return (
    <div>
      {/* 使用 Tailwind 控制大小 */}
      <Anthropic className="w-8 h-8" />

      {/* 悬停效果（注意：颜色不可更改，但可添加缩放、阴影等效果） */}
      <Deepseek className="w-10 h-10 hover:scale-110 cursor-pointer transition-transform" />

      {/* 响应式设计 */}
      <Anthropic className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10" />

      {/* 添加阴影和圆角效果 */}
      <Deepseek className="w-12 h-12 rounded-lg shadow-lg hover:shadow-xl transition-shadow" />
    </div>
  );
}
```

**重要提示：**

- ❌ **不要尝试修改图标颜色**（这些是品牌 Logo，颜色是固定的）
- ✅ 可以修改 `size`、`className`
- ✅ 可以使用 Tailwind 的 `scale`、`opacity`、`transform`、`shadow` 等效果

### 事件处理

```tsx
import { Anthropic, Deepseek } from '@cherrystudio/ui/icons';

export function EventExample() {
  const handleClick = () => {
    console.log('Logo clicked!');
  };

  return (
    <div className="flex gap-4">
      {/* onClick 事件 */}
      <Anthropic onClick={handleClick} className="cursor-pointer hover:opacity-80" />

      {/* 其他事件 */}
      <Deepseek
        onMouseEnter={() => console.log('Mouse enter')}
        onMouseLeave={() => console.log('Mouse leave')}
        className="cursor-pointer transition-opacity hover:opacity-75"
      />
    </div>
  );
}
```

### 使用 ref

```tsx
import { Anthropic } from '@cherrystudio/ui/icons';
import { useRef, useEffect } from 'react';

export function RefExample() {
  const iconRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (iconRef.current) {
      console.log('Logo SVG element:', iconRef.current);
      // 可以执行 DOM 操作，如添加动画
    }
  }, []);

  return <Anthropic ref={iconRef} size={32} />;
}
```

### 自定义彩色图标

如果你有自己的彩色 SVG 图标，可以手动创建：

```tsx
import { createIcon, type IconNode } from '@cherrystudio/ui/icons';

// 定义自定义彩色图标数据（带嵌套和颜色）
const customLogoNode: IconNode = [
  ['g', { clipPath: 'url(#clip0)' }, [
    ['circle', { cx: '12', cy: '12', r: '10', fill: '#FF6B6B' }],
    ['path', { d: 'M12 6v6l4 2', stroke: '#fff', strokeWidth: '2' }]
  ]],
  ['defs', {}, [
    ['clipPath', { id: 'clip0' }, [
      ['rect', { width: '24', height: '24', fill: 'white' }]
    ]]
  ]]
];

// 创建自定义图标组件
const MyBrandLogo = createIcon('MyBrandLogo', customLogoNode);

export function CustomIconExample() {
  return <MyBrandLogo size={48} className="hover:scale-110 transition-transform" />;
}
```

### 组合使用

```tsx
import { Anthropic, Deepseek, Cohere } from '@cherrystudio/ui/icons';

export function CompositeExample() {
  return (
    <div className="space-y-6">
      {/* AI 模型选择器 */}
      <div className="flex gap-4">
        {[
          { Logo: Anthropic, name: 'Claude' },
          { Logo: Deepseek, name: 'DeepSeek' },
          { Logo: Cohere, name: 'Cohere' }
        ].map(({ Logo, name }) => (
          <button
            key={name}
            className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Logo size={48} />
            <span className="text-sm font-medium">{name}</span>
          </button>
        ))}
      </div>

      {/* Logo 网格展示 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow">
          <Anthropic size={32} />
        </div>
        <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow">
          <Deepseek size={32} />
        </div>
        <div className="flex items-center justify-center p-4 bg-white rounded-lg shadow">
          <Cohere size={32} />
        </div>
      </div>
    </div>
  );
}
```

---

## 工作流程

### 开发流程

```bash
# 1. 准备 SVG 文件
# 将 SVG 文件放到 packages/ui/icons/ 目录

# 2. 生成图标组件
cd packages/ui
pnpm generate:icons

# 3. 在主包中使用
# 主包会通过 Vite alias 自动识别，直接导入使用
```

### 生成的文件

```
packages/ui/src/components/icons/
├── Icon.tsx                    # ✅ 手写（基础组件）
├── generated/                  # ⚠️  自动生成（不要手动编辑）
│   ├── ArrowRight.tsx
│   ├── Check.tsx
│   ├── Close.tsx
│   ├── ... (40+ 个文件)
│   └── index.ts
└── index.ts                    # ✅ 手写（统一导出）
```

### 构建流程

**开发模式：**
- 主包通过 Vite alias 直接引用 UI 包源码
- 支持热更新（HMR）
- 无需构建 UI 包

**生产构建：**

```bash
# UI 包单独构建（如需发布）
cd packages/ui
pnpm build  # 会先 generate:icons，然后 tsdown 打包

# 主包构建
cd cherry-studio
pnpm build  # Vite 会处理 UI 包的源码
```

---

## 常见问题

### Q1: 为什么主包可以直接使用源码？

**A:** 因为主包的 Vite 配置了 alias：

```typescript
// electron.vite.config.ts
'@cherrystudio/ui': resolve('packages/ui/src')
```

这样导入的是 `.tsx` 源文件，Vite 会像处理主包代码一样处理这些文件，支持热更新和 TypeScript 类型推导。

---

### Q2: 彩色 Logo SVG 文件有什么要求？

**A:** 针对彩色品牌 Logo 的要求：

- ✅ 使用标准的 24x24 viewBox（推荐）
- ✅ 保留所有 `fill` 颜色（会自动保留）
- ✅ 支持复杂嵌套结构（`<g>`, `<clipPath>`, `<defs>` 等）
- ✅ 文件名使用 kebab-case（如 `anthropic.svg`、`deep-seek.svg`）
- ✅ 数字开头的文件名会自动转换（如 `302ai.svg` → `Ai302` 组件）

示例彩色 Logo SVG：
```xml
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g clip-path="url(#clip0)">
    <path d="M18 0H6C2.68629 0..." fill="#CA9F7B"/>
    <path d="M15.3843 6.43481H12..." fill="#191918"/>
  </g>
  <defs>
    <clipPath id="clip0">
      <rect width="24" height="24" fill="white"/>
    </clipPath>
  </defs>
</svg>
```

**注意事项：**

- ⚠️ 确保 SVG 格式正确（使用 Figma/Illustrator 导出时选择"优化"）
- ⚠️ ID 属性可能需要全局唯一（如 `clip0` 改为 `clip-anthropic`）
- ⚠️ 过大的 SVG 文件（超过 100KB）建议先手动优化

---

### Q3: 如何调试生成错误？

**A:** 如果某个图标生成失败：

1. **检查 SVG 文件语法**：使用浏览器直接打开 SVG 文件，看是否正常显示
2. **测试 SVGO 优化**：
   ```bash
   npx svgo icons/your-icon.svg -o test.svg
   ```
3. **查看生成脚本的错误日志**：运行 `pnpm generate:icons` 时会显示详细错误
4. **验证 SVG 结构**：本方案支持所有标准 SVG 元素（通过 svgson 解析）
5. **检查文件编码**：确保 SVG 文件是 UTF-8 编码

---

### Q4: 如何添加新图标？

**A:** 非常简单：

```bash
# 1. 将新的 SVG 文件放入 icons/ 目录
cp new-icon.svg packages/ui/icons/

# 2. 重新生成
cd packages/ui
pnpm generate:icons

# 3. 立即可用（无需重启开发服务器）
import { NewIcon } from '@cherrystudio/ui/icons';
```

---

### Q5: 如何自定义生成的代码？

**A:** 修改 `scripts/generate-icons.ts` 中的 `generateIconComponent` 函数：

```typescript
async function generateIconComponent(
  iconName: string,
  iconNode: string
): Promise<string> {
  const componentName = toPascalCase(iconName);

  // 在这里自定义生成的代码模板
  return `...`;
}
```

---

### Q6: TypeScript 类型如何工作？

**A:** 完全自动，无需手动声明：

```typescript
// IconProps 继承自 React.SVGProps<SVGSVGElement>
// 所以支持所有 SVG 属性

<Anthropic
  size={24}                // IconProps 自定义（数字或字符串）
  className="..."          // SVGProps
  onClick={() => {}}       // SVGProps
  onMouseEnter={() => {}}  // SVGProps
  style={{ opacity: 0.8 }} // SVGProps
  aria-label="Anthropic"   // SVGProps
  // ... 所有 SVG 属性
/>
```

**注意：** 彩色 Logo 版本移除了 `color` 和 `strokeWidth` 属性（因为颜色是固定的）

---

### Q7: 生成的文件需要提交到 Git 吗？

**A:** 推荐做法：

- ✅ **提交** `generated/` 目录（方便团队协作）
- ✅ **在 CI/CD 中重新生成**（确保一致性）

`.gitignore` 配置：
```gitignore
# 可选：不提交生成文件（需要在 CI 中生成）
# packages/ui/src/components/icons/generated/

# 必须提交 icons 源文件
!packages/ui/icons/*.svg
```

---

### Q8: 能否修改 Logo 的颜色？

**A:** ❌ **不建议修改品牌 Logo 的颜色**

这些是品牌官方 Logo，颜色是品牌标识的一部分，**不应该修改**。

**替代方案：**

```tsx
import { Anthropic } from '@cherrystudio/ui/icons';

// ✅ 可以调整透明度
<Anthropic className="opacity-50" />
<Anthropic style={{ opacity: 0.8 }} />

// ✅ 可以添加滤镜效果（慎用）
<Anthropic className="grayscale" />  // 灰度滤镜
<Anthropic style={{ filter: 'brightness(1.2)' }} />

// ❌ 不要尝试修改颜色
// <Anthropic style={{ fill: 'red' }} />  // 无效
// <Anthropic className="text-red-500" />  // 无效
```

**为什么无法修改颜色？**

- 颜色信息存储在 IconNode 数据中（如 `fill="#CA9F7B"`）
- 这是设计决策：保护品牌标识的完整性
- 如果需要可变颜色的图标，应该使用 Lucide 等线性图标库

---

### Q9: 如何与 Lucide React 共存？

**A:** 完全可以同时使用：

```tsx
// 使用彩色品牌 Logo（84个）
import { Anthropic, Deepseek } from '@cherrystudio/ui/icons';

// 使用 Lucide 线性图标
import { Heart, Settings, User } from 'lucide-react';

export function MixedExample() {
  return (
    <div>
      {/* 品牌 Logo：固定颜色 */}
      <Anthropic size={24} />
      <Deepseek size={24} />

      {/* Lucide 图标：可变颜色 */}
      <Heart size={24} color="red" />
      <Settings size={24} className="text-blue-500" />
    </div>
  );
}
```

两者的 API 基本一致（都继承自 Lucide 的设计），但用途不同：

- **Cherry Studio Icons**：彩色品牌 Logo
- **Lucide Icons**：单色通用图标

---

### Q10: 性能如何？

**A:** 性能优秀：

- 📦 **体积小**：每个图标约 0.5-1.5KB（IconNode 数据）
- ⚡ **渲染快**：直接 `createElement`，无需解析
- 🌲 **Tree-shaking**：只打包使用的图标
- 💾 **无运行时**：零运行时依赖
- 🎨 **保留细节**：完整保留彩色 Logo 的所有颜色和细节

对比：

```
传统方式（内联 SVG JSX）：~2-3KB/Logo
IconNode 方式（彩色）：~0.5-1.5KB/Logo
节省：~50-75% 体积
```

**注意：** 彩色 Logo 比简单线性图标稍大，因为包含更多颜色和路径信息，但仍然非常高效。

---

### Q11: 如何批量更新图标？

**A:** 直接替换 SVG 文件，然后重新生成：

```bash
# 1. 更新 SVG 文件（替换现有的或添加新的）
cp new-logos/*.svg packages/ui/icons/

# 2. 重新生成组件
cd packages/ui
pnpm generate:icons

# 3. 所有使用该图标的地方自动更新（无需修改代码）
```

**批量处理技巧：**

```bash
# 批量优化 SVG（使用 SVGO）
npx svggo -f icons/ -o icons-optimized/

# 批量重命名（确保 kebab-case）
# 使用 rename 工具或脚本处理
```

---

## 附录

### A. 命名规范

**SVG 文件名（品牌 Logo）：**

- 使用 kebab-case：`anthropic.svg`、`deep-seek.svg`
- 只包含小写字母、数字、连字符
- 使用品牌官方名称
- 数字开头会自动处理：`302ai.svg` → `Ai302`

**组件名（自动生成）：**

- 自动转换为 PascalCase：`Anthropic`、`DeepSeek`、`Ai302`
- 无需手动指定

### B. SVGO 配置说明（彩色 Logo 专用）

```javascript
{
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,       // 保留 viewBox（必须）
          convertShapeToPath: false,  // 不转换为 path（保持原始形状）
          removeHiddenElems: false,   // 不移除隐藏元素（保留 defs）
        },
      },
    },
    {
      name: 'removeAttrs',
      params: {
        attrs: '(width|height)',      // 只移除 width/height，保留所有颜色
      },
    },
  ],
}
```

**关键差异：**

- ✅ **保留 fill**：不移除颜色属性（传统方案会移除）
- ✅ **保留 defs**：保留 clipPath、linearGradient 等定义
- ✅ **保留嵌套**：完整保留 `<g>` 嵌套结构

### C. 目录结构完整示例（彩色品牌 Logo）

```
packages/ui/
├── icons/                           # 彩色 Logo SVG 源文件
│   ├── 302ai.svg
│   ├── aiOnly.svg
│   ├── aihubmix.svg
│   ├── anthropic.svg
│   ├── aws-bedrock.svg
│   ├── baichuan.svg
│   ├── baidu-cloud.svg
│   ├── bailian.svg
│   ├── bytedance.svg
│   ├── cephalon.svg
│   ├── cherryin.svg
│   ├── cohere.svg
│   ├── dashscope.svg
│   ├── deepseek.svg
│   └── ... (40+ 品牌 Logo)
│
├── scripts/
│   └── generate-icons.ts            # 生成脚本（支持嵌套和彩色）
│
├── src/
│   └── components/
│       └── icons/
│           ├── Icon.tsx             # 基础组件（支持嵌套渲染）
│           ├── index.ts             # 统一导出
│           └── generated/           # 自动生成的 Logo 组件
│               ├── Ai302.tsx
│               ├── AiOnly.tsx
│               ├── Aihubmix.tsx
│               ├── Anthropic.tsx
│               ├── AwsBedrock.tsx
│               ├── Baichuan.tsx
│               ├── BaiduCloud.tsx
│               ├── Bailian.tsx
│               ├── Bytedance.tsx
│               ├── Cephalon.tsx
│               ├── Cherryin.tsx
│               ├── Cohere.tsx
│               ├── Dashscope.tsx
│               ├── Deepseek.tsx
│               ├── ... (40+ 组件)
│               └── index.ts
│
└── package.json
```

---

## 总结

本方案借鉴 Lucide 的核心 IconNode 架构，专门为 Cherry Studio UI 库打造了一个轻量级、高性能的**彩色品牌 Logo 图标系统**：

### 核心优势

✅ **保留原色**：完整保留品牌 Logo 的所有颜色和细节
✅ **支持嵌套**：处理复杂的 SVG 结构（g, clipPath, defs 等）
✅ **自动生成**：一键从 SVG 生成 React 组件，无需手动编写
✅ **高效轻量**：IconNode 数据结构，体积小、渲染快
✅ **类型安全**：完整的 TypeScript 支持
✅ **Tailwind 友好**：完美集成 Tailwind CSS
✅ **易于维护**：工厂模式，统一管理，易于扩展

### 与传统方案的区别

| 特性 | 传统线性图标（Lucide） | 本方案（彩色 Logo） |
|------|---------------------|------------------|
| **颜色** | 单色，可动态改变 | 多色，保留原色 |
| **复杂度** | 简单路径 | 支持嵌套结构 |
| **用途** | 通用 UI 图标 | 品牌 Logo 展示 |
| **体积** | ~0.3KB | ~0.5-1.5KB |

### 快速开始

```bash
cd packages/ui

# 1. 安装依赖
pnpm add -D svgo svgson tsx

# 2. 准备 SVG 文件（已有 84 个品牌 Logo）
# icons/ 目录已包含: anthropic.svg, deepseek.svg, cohere.svg...

# 3. 生成组件
pnpm generate:icons

# 4. 在代码中使用（推荐使用 /icons 子路径）
# import { Anthropic, Deepseek } from '@cherrystudio/ui/icons';
```

现在就可以在主包中使用彩色品牌 Logo 了！🎉

### 下一步

1. 阅读[使用示例](#使用示例)了解更多用法
2. 查看[常见问题](#常见问题)解决疑惑
3. 将更多品牌 Logo SVG 添加到 `icons/` 目录
4. 运行 `pnpm generate:icons` 生成新组件
