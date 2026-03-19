# CherryStudio V2 导出系统重构规划

**版本**: v1.0-draft
**日期**: 2025-12-30
**目的**: PR Draft - 与 V2 负责人讨论导出系统重构方向

---

## 一、背景与现状

### 1.1 问题陈述

| 问题 | 影响 | 优先级 |
|------|------|--------|
| 数据源过时 | 依赖旧版消息格式，需适配新的 `data.blocks` 结构 | 高 |
| 图片缺失 | Markdown/Obsidian 导出不包含图片附件 | 高 |
| 第三方集成问题 | Notion 导出内容缺失，Joplin 无法指定笔记本 | 高 |
| 格式支持不足 | 缺少 JSONL 等训练数据格式 | 中 |
| 批量导出缺失 | 无法批量选择多个对话导出 | 中 |

### 1.2 GitHub Issue 需求

| Issue | 需求 | 优先级 |
|-------|------|--------|
| #10291 | Markdown/Obsidian 导出时包含图片 | 高 |
| #11384 | Notion 导出内容缺失 | 高 |
| #12033 | 支持 JSONL 格式导出 | 中 |
| #11621 | 批量导出到第三方平台 | 中 |
| #11139 | Joplin 导出指定笔记本 | 中 |
| #10870 | 图片导出只导出部分内容 | 中 |

---

## 二、架构设计

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  packages/shared/export/                                    │
│  ├── types.ts        # ExportOptions、ExportFormat          │
│  └── formats.ts      # 格式枚举                             │
├─────────────────────────────────────────────────────────────┤
│  src/main/services/export/                                  │
│  ├── ExportOrchestrator.ts    # 导出编排                    │
│  ├── ImageHandler.ts          # 图片处理（主进程）          │
│  └── platforms/                                           │
│      ├── NotionExporter.ts                                 │
│      ├── ObsidianExporter.ts                               │
│      ├── JoplinExporter.ts                                 │
│      ├── YuqueExporter.ts                                  │
│      └── SiyuanExporter.ts                                 │
├─────────────────────────────────────────────────────────────┤
│  src/renderer/src/services/export/                          │
│  ├── formatters/                                            │
│  │   ├── MarkdownExporter.ts                               │
│  │   ├── JsonlExporter.ts                                  │
│  │   ├── PlainTextExporter.ts                              │
│  │   └── DocxExporter.ts                                   │
│  ├── BatchExporter.ts         # 批量导出                    │
│  └── ExportDialog.tsx         # 导出对话框                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| 图片处理 | 主进程 ImageHandler | 解决跨域/文件访问问题 |
| 数据源 | DataApiService | 与 V2 架构对齐 |
| 批量导出 | BatchExporter | 支持多对话导出 |
| 格式扩展 | BaseFormatter 接口 | 便于添加新格式 |

---

## 三、核心数据结构

### 3.1 导出格式枚举

```typescript
enum ExportFormat {
  MARKDOWN = 'markdown',
  JSONL = 'jsonl',
  JSON = 'json',
  PLAIN_TEXT = 'plain_text',
  DOCX = 'docx',
  IMAGE = 'image'
}
```

### 3.2 图片策略

```typescript
enum ImageStrategy {
  NONE = 'none',       // 不导出图片
  BASE64 = 'base64',   // Base64 内嵌
  LOCAL = 'local',     // 本地文件夹
  PICGO = 'picgo',     // PicGo 上传
  REMOTE = 'remote'    // 保持远程链接
}
```

### 3.3 导出选项

```typescript
interface ExportOptions {
  format: ExportFormat

  // 内容选项
  includeReasoning?: boolean    // 包含思维链
  excludeCitations?: boolean    // 排除引用
  flattenBranches?: boolean     // 合并分支为线性

  // 图片选项
  imageStrategy?: ImageStrategy
  imageFolder?: string          // 本地图片文件夹路径

  // Markdown 选项
  forceDollarMath?: boolean     // 强制使用 $ 数学公式
  showModelName?: boolean       // 显示模型名称
  showProvider?: boolean        // 显示提供商

  // JSONL 选项
  jsonlFormat?: 'openai' | 'anthropic' | 'custom'
  systemPrompt?: string         // 自定义系统提示
}
```

---

## 四、开放讨论点

1. **ImageHandler 位置**: 是否同意将图片处理移至主进程？
2. **批量导出 UI**: 是否需要独立的批量导出对话框？
3. **JSONL 格式**: 哪些训练数据格式是必需的？（OpenAI/Anthropic/Custom）
4. **平台集成优先级**: Notion/Joplin/Obsidian 的修复顺序？

---

## 五、文件变更清单

### 新增文件

```
packages/shared/export/
├── types.ts
└── formats.ts

src/main/services/export/
├── ExportOrchestrator.ts
├── ImageHandler.ts
└── platforms/
    ├── NotionExporter.ts
    ├── ObsidianExporter.ts
    ├── JoplinExporter.ts
    ├── YuqueExporter.ts
    └── SiyuanExporter.ts

src/renderer/src/services/export/
├── formatters/
│   ├── BaseFormatter.ts
│   ├── MarkdownExporter.ts
│   ├── JsonlExporter.ts
│   ├── PlainTextExporter.ts
│   └── DocxExporter.ts
├── BatchExporter.ts
└── ExportDialog.tsx
```

### 重构文件

- `src/renderer/src/utils/export.ts` - 迁移到新架构
- `src/main/services/ExportService.ts` - 适配新架构
- `src/main/services/ObsidianVaultService.ts` - 增加图片支持

---

**文档版本**: v1.0-draft
**创建日期**: 2025-12-30
**待讨论后完善**
