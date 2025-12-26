# 数据分类与代码生成工具

Cherry Studio 数据重构项目的自动化工具集，用于管理数据分类和生成 TypeScript 代码。

**版本**: 2.0.0
**更新日期**: 2025-11-28

## 概述

本工具集提供以下功能：
- **数据提取**: 扫描源代码，构建数据清单
- **分类管理**: 维护分类映射，支持增量更新
- **代码生成**: 生成 TypeScript 接口和迁移映射
- **验证检查**: 确保清单与分类之间的一致性

## 目录结构

```
v2-refactor-temp/tools/data-classify/
├── scripts/
│   ├── lib/
│   │   └── classificationUtils.js  # 共享工具函数
│   ├── extract-inventory.js        # 从源码提取数据清单
│   ├── generate-all.js             # 运行所有生成器
│   ├── generate-preferences.js     # 生成 preferenceSchemas.ts
│   ├── generate-migration.js       # 生成 PreferencesMappings.ts
│   ├── validate-consistency.js     # 验证数据一致性
│   ├── validate-generation.js      # 验证生成代码质量
│   └── check-duplicates.js         # 检查重复的目标键
├── data/
│   ├── classification.json         # 分类映射（人工维护）
│   └── inventory.json              # 数据清单（脚本生成）
├── package.json
└── README.md                       # 本文档
```

## 快速开始

```bash
# 进入工具目录
cd v2-refactor-temp/tools/data-classify

# 安装依赖
npm install

# 运行完整工作流
npm run all

# 或者分步执行
npm run extract          # 提取数据清单
npm run generate         # 生成所有代码
npm run validate         # 验证一致性
npm run validate:gen     # 验证生成代码
```

## 可用脚本

| 脚本 | 说明 |
|------|------|
| `npm run extract` | 从源文件提取数据清单 |
| `npm run generate` | 运行所有代码生成器 |
| `npm run generate:preferences` | 仅生成 preferenceSchemas.ts |
| `npm run generate:migration` | 仅生成 PreferencesMappings.ts |
| `npm run validate` | 验证数据一致性 |
| `npm run validate:gen` | 验证生成代码质量 |
| `npm run check:duplicates` | 检查重复的目标键 |
| `npm run all` | 运行完整工作流 |

## 脚本架构

### 依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                      共享模块                                │
│  scripts/lib/classificationUtils.js                         │
│  - loadClassification()    - traverseClassifications()      │
│  - saveClassification()    - calculateStats()               │
│  - loadInventory()         - normalizeType()                │
│  - extractPreferencesData() - inferTypeFromValue()          │
└─────────────────────────────────────────────────────────────┘
                    ▲                    ▲
                    │                    │
        ┌───────────┘                    └───────────┐
        │                                            │
┌───────┴───────┐                          ┌────────┴────────┐
│ extract-      │                          │ validate-       │
│ inventory.js  │                          │ consistency.js  │
│               │                          │                 │
│ 扫描源码      │                          │ 检查数据        │
│ 构建清单      │                          │ 一致性          │
└───────────────┘                          └─────────────────┘

┌─────────────────────┐
│   generate-all.js   │──────────────────────────────────┐
│                     │                                  │
│   编排所有生成器    │                                  │
└─────────────────────┘                                  │
         │                                               │
         │ require()                                     │ require()
         ▼                                               ▼
┌─────────────────────┐                    ┌─────────────────────┐
│ generate-           │                    │ generate-           │
│ preferences.js      │                    │ migration.js        │
│                     │                    │                     │
│ 生成                │                    │ 生成                │
│ preferenceSchemas.ts│                    │ PreferencesMappings │
└─────────────────────┘                    └─────────────────────┘

┌─────────────────────┐                    ┌─────────────────────┐
│ validate-           │                    │ check-              │
│ generation.js       │                    │ duplicates.js       │
│                     │                    │                     │
│ 验证生成代码质量    │                    │ 检查重复目标键      │
│ (独立运行)          │                    │ (独立运行)          │
└─────────────────────┘                    └─────────────────────┘
```

### 脚本详情

| 脚本 | 输入 | 输出 | 依赖 |
|------|------|------|------|
| `extract-inventory.js` | 源代码文件 | `data/inventory.json` | `classificationUtils.js` |
| `generate-preferences.js` | `classification.json` | `preferenceSchemas.ts` | 无 |
| `generate-migration.js` | `classification.json` | `PreferencesMappings.ts` | 无 |
| `generate-all.js` | - | 运行两个生成器 | `generate-preferences.js`, `generate-migration.js` |
| `validate-consistency.js` | `inventory.json`, `classification.json` | `validation-report.md` | `classificationUtils.js` |
| `validate-generation.js` | 生成的 `.ts` 文件 | 控制台输出 | 无 |
| `check-duplicates.js` | `classification.json` | 控制台输出 | 无 |

## 数据分类工作流

### 1. 提取数据清单

```bash
npm run extract
```

扫描源文件并提取以下数据源的信息：
- **Redux Store**: `src/renderer/src/store/*.ts`
- **Electron Store**: `src/main/services/ConfigManager.ts`
- **LocalStorage**: 所有使用 localStorage 的文件
- **Dexie 数据库**: `src/renderer/src/databases/index.ts`

### 2. 分类数据

编辑 `data/classification.json` 对每个数据项进行分类：

```json
{
  "originalKey": "theme",
  "type": "string",
  "status": "classified",
  "category": "preferences",
  "targetKey": "ui.theme_mode"
}
```

### 3. 生成代码

```bash
npm run generate
```

生成以下 TypeScript 文件：
- `packages/shared/data/preference/preferenceSchemas.ts` - 类型定义
- `src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts` - 迁移映射

### 4. 验证

```bash
npm run validate
npm run validate:gen
```

验证内容：
- 所有清单项都已分类
- 没有孤立的分类条目
- 命名规范一致
- 没有重复的目标键
- 生成代码结构正确

---

## 数据分类标准

根据 Cherry Studio 数据重构架构，所有数据需要分类到以下 5 个类别之一：

### 1. 偏好配置 (preferences)

**判断标准**:
- ✅ 影响应用全局行为的配置
- ✅ 用户可以修改的设置项
- ✅ 简单的数据类型（boolean/string/number/简单 array/object）
- ✅ 结构相对稳定，不经常变化
- ✅ 数据量小，可以重建
- ✅ 需要在窗口间同步

**典型例子**:
- `showAssistants`: 是否显示助手面板
- `theme`: 主题设置（light/dark/system）
- `fontSize`: 字体大小
- `language`: 界面语言

**命名规范**:
- 使用点分隔的层级结构：`ui.fontSize`、`system.language`
- 分组前缀：`ui.*`（界面）、`system.*`（系统）、`app.*`（应用行为）等

### 2. 用户数据 (user_data)

**判断标准**:
- ✅ 用户创建或输入的内容
- ✅ 不可丢失的重要数据
- ✅ 数据量可能很大
- ✅ 需要完整备份和迁移机制
- ✅ 可能包含敏感信息

**典型例子**:
- `topics`: 对话历史
- `messages`: 消息内容
- `files`: 用户上传的文件
- `knowledge_notes`: 知识库笔记

**特殊处理**:
- 敏感数据需要加密存储
- 大数据表需要考虑分页和流式处理

### 3. 缓存数据 (cache)

**判断标准**:
- ✅ 可以重新生成的数据
- ✅ 主要用于性能优化
- ✅ 丢失后不影响核心功能
- ✅ 有过期时间或清理机制

**典型例子**:
- `failed_favicon_*`: 失败的 favicon 缓存
- 搜索结果缓存
- 图片预览缓存
- 模型响应缓存

### 4. 运行时数据 (runtime)

**判断标准**:
- ✅ 内存型数据，不需要持久化
- ✅ 生命周期 ≤ 应用进程
- ✅ 应用重启后可以丢失
- ✅ 临时状态信息

**典型例子**:
- 当前选中的对话
- 临时的输入状态
- UI 组件的展开/折叠状态
- 网络请求状态

### 5. 应用资源 (resources)

**判断标准**:
- ✅ 静态资源文件
- ✅ 随应用分发的内容
- ✅ 不需要用户修改
- ✅ 暂不考虑重构

**典型例子**:
- 图标文件
- 本地化翻译文件
- 默认配置文件
- 帮助文档

---

## 分类决策流程图

```
数据项
  ↓
是否用户创建/输入的内容？
  ↓ 是                    ↓ 否
用户数据              是否需要持久化？
                        ↓ 否        ↓ 是
                    运行时数据    是否可重新生成？
                                  ↓ 是         ↓ 否
                                缓存数据     是否用户可修改？
                                              ↓ 是        ↓ 否
                                            偏好配置    应用资源
```

---

## 分类示例

### 示例 1: Redux settings.showAssistants

```json
{
  "classifications": {
    "redux": {
      "settings": [
        {
          "originalKey": "showAssistants",
          "type": "boolean",
          "defaultValue": true,
          "status": "classified",
          "category": "preferences",
          "targetKey": "ui.show_assistants"
        }
      ]
    }
  }
}
```

**分析过程**:
1. 数据用途：控制是否显示助手面板
2. 用户可修改：✅
3. 影响全局：✅
4. 数据简单：✅ boolean 类型
5. 结论：偏好配置

### 示例 2: 嵌套结构 (Redux settings with children)

```json
{
  "originalKey": "codeEditor",
  "type": "object",
  "children": [
    {
      "originalKey": "enabled",
      "type": "boolean",
      "defaultValue": true,
      "status": "classified",
      "category": "preferences",
      "targetKey": "code_editor.enabled"
    },
    {
      "originalKey": "fontSize",
      "type": "number",
      "defaultValue": 14,
      "status": "classified",
      "category": "preferences",
      "targetKey": "code_editor.font_size"
    }
  ]
}
```

**注意**: 父级项不需要 `status`/`category`/`targetKey`，这些只在叶子节点设置。

### 示例 3: Dexie topics 表

```json
{
  "originalKey": "topics",
  "type": "table",
  "status": "classified",
  "category": "user_data",
  "targetTable": "topic",
  "notes": "用户对话历史，核心业务数据"
}
```

---

## 命名规范

偏好配置键必须遵循：`namespace.sub.key_name`

**规则**:
- 至少 2 个由点分隔的段
- 仅使用小写字母、数字、下划线
- 模式：`/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`

**示例**:
- `app.theme` (有效)
- `chat.input.send_shortcut` (有效)
- `Theme` (无效 - 没有点分隔符)
- `App.User` (无效 - 大写字母)

---

## 增量更新策略

### 核心特性
- **保留已分类数据**: 重新运行提取不会丢失已有分类
- **标记删除项**: 删除的数据项被标记但不移除
- **自动发现新项**: 新数据项自动添加到待处理列表
- **自动备份**: 每次运行前自动备份原分类文件

### 更新流程
1. 代码变更后运行 `npm run extract`
2. 脚本自动备份 `classification.json` 到 `classification.backup.json`
3. 脚本识别新增和删除的数据项
4. 新项添加到 `pending` 数组
5. 删除项标记为 `status: 'classified-deleted'`
6. 手动处理新的待处理项

---

## 文件格式说明

### inventory.json 结构

```json
{
  "metadata": {
    "generatedAt": "ISO 日期",
    "version": "版本号"
  },
  "redux": {
    "moduleName": {
      "fieldName": {
        "type": "数据类型",
        "defaultValue": "默认值"
      }
    }
  },
  "electronStore": { ... },
  "localStorage": { ... },
  "dexie": { ... }
}
```

### classification.json 结构

```json
{
  "metadata": {
    "version": "版本号",
    "lastUpdated": "ISO 日期"
  },
  "classifications": {
    "redux": {
      "moduleName": [
        {
          "originalKey": "字段名",
          "type": "数据类型",
          "status": "classified|pending|classified-deleted",
          "category": "preferences|user_data|cache|runtime|resources",
          "targetKey": "target.key.name"
        }
      ]
    },
    "electronStore": { ... },
    "localStorage": { ... },
    "dexie": { ... }
  }
}
```

### 状态值说明

| Status | 说明 | 操作建议 |
|--------|------|----------|
| `pending` | 待分类 | 需要人工分析并设置 category 和 targetKey |
| `classified` | 已分类 | 分类完成，可用于代码生成 |
| `classified-deleted` | 已分类但源已删除 | 源代码中已不存在，保留历史记录 |

---

## 故障排除

### "Module not found" 错误

```bash
cd v2-refactor-temp/tools/data-classify
npm install
```

### 验证错误

1. 检查 `validation-report.md` 了解详情
2. 修复 `classification.json` 条目
3. 重新运行验证

### 生成代码问题

1. 运行 `npm run validate:gen` 识别问题
2. 检查源分类数据
3. 使用 `npm run generate` 重新生成

### 数据项被错误标记为删除

检查提取脚本的模式是否正确匹配代码结构。

### 如何恢复意外删除的分类

从以下位置恢复 `classification.json`：
- 自动备份文件：`classification.backup.json`
- Git 历史记录

---

## 当前进度 (2025-11-28)

### 已完成
1. **自动生成映射关系** - `generate-migration.js` 生成纯映射代码
2. **158 个真实配置项迁移** - 替换了原来的 3 个硬编码测试项
3. **嵌套路径支持** - 处理 Redux Store children 结构（39 个嵌套路径）
4. **类型安全迁移** - 基于 `preferenceSchemas.ts` 类型定义
5. **脚本重构** - 共享工具、一致路径、移除废弃脚本

### 生成的核心文件
- **preferenceSchemas.ts** - 类型安全配置定义（200 个偏好项）
- **PreferencesMappings.ts** - 纯映射常量（ElectronStore + Redux 项）

### 技术特性
- **数据源分离**: ElectronStore（简单数组）、Redux Store（按类别分组）
- **嵌套路径解析**: 支持 `codeEditor.enabled`、`exportMenuOptions.docx` 等
- **统一默认值管理**: 单一数据源，无重复定义
- **自动去重**: 重复 targetKey 自动处理（redux 优先级最高）
