# Stories 文档

这里存放所有组件的 Storybook stories 文件，与源码分离以保持项目结构清晰。

## 目录结构

```
stories/
├── components/
│   ├── base/           # 基础组件 stories
│   ├── display/        # 展示组件 stories
│   ├── interactive/    # 交互组件 stories
│   ├── icons/          # 图标组件 stories
│   ├── layout/         # 布局组件 stories
│   └── composite/      # 复合组件 stories
└── README.md          # 本说明文件
```

## 命名约定

- 文件名格式：`ComponentName.stories.tsx`
- Story 标题格式：`分类/组件名`，如 `Base/CustomTag`
- 导入路径：使用相对路径导入源码组件，如 `../../../src/components/base/ComponentName`

## 编写指南

每个 stories 文件应该包含：

1. **Default** - 基本用法示例
2. **Variants** - 不同变体/状态
3. **Interactive** - 交互行为演示（如果适用）
4. **Use Cases** - 实际使用场景

## 启动 Storybook

```bash
cd packages/ui
yarn storybook
```

访问 http://localhost:6006 查看组件文档。
