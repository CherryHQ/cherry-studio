# 文件列表模糊搜索

本文档描述了 Cherry Studio 中文件列表的模糊搜索实现。

## 概述

模糊搜索功能允许用户通过输入部分或近似的文件名/路径来查找文件。它使用两层匹配策略以获得最佳性能和灵活性。

## 功能特性

- **子序列匹配**：查询中的字符必须按顺序出现在文件路径中，但不必连续
- **贪婪子串匹配**：当子序列匹配无结果时的回退策略
- **相关性评分**：结果按相关性分数排序
- **性能优化**：使用 ripgrep 进行预过滤，然后再进行 JavaScript 处理

## 匹配策略

### 1. Ripgrep Glob 预过滤（主要）

查询被转换为 glob 模式供 ripgrep 进行初始过滤：

```
查询: "updater"
Glob: "*u*p*d*a*t*e*r*"
```

这利用了 ripgrep 的原生性能进行初始文件过滤。

### 2. 贪婪子串匹配（回退）

当 glob 预过滤无结果时，系统回退到贪婪子串匹配。这允许更灵活的匹配：

```
查询: "updatercontroller"
文件: "packages/update/src/node/updateController.ts"

匹配过程:
1. 找到 "update"（从开头的最长匹配）
2. 剩余 "rcontroller" → 找到 "r" 然后 "controller"
3. 所有部分都匹配 → 成功
```

## 评分算法

结果根据相关性分数排名：

| 因素 | 分数 |
|------|------|
| 路径段匹配 | 每段 +60 |
| 文件名包含精确子串 | +80 |
| 文件名以查询开头 | +100 |
| 连续字符匹配 | 每字符 +15 |
| 词边界匹配 | 每匹配 +20 |
| 路径长度惩罚 | 每字符 -0.8 |

### 评分示例

对于查询 `updater`：

| 文件 | 评分因素 |
|------|----------|
| `RCUpdater.js` | 短路径 + 文件名包含 "updater" |
| `updateController.ts` | 多个路径段匹配 |
| `UpdaterHelper.plist` | 长路径惩罚 |

## 配置

### DirectoryListOptions

```typescript
interface DirectoryListOptions {
  recursive?: boolean      // 默认: true
  maxDepth?: number        // 默认: 10
  includeHidden?: boolean  // 默认: false
  includeFiles?: boolean   // 默认: true
  includeDirectories?: boolean // 默认: true
  maxEntries?: number      // 默认: 20
  searchPattern?: string   // 默认: '.'
  fuzzy?: boolean          // 默认: true
}
```

## 使用方法

```typescript
// 基本模糊搜索
const files = await window.api.file.listDirectory(dirPath, {
  searchPattern: 'updater',
  fuzzy: true,
  maxEntries: 20
})

// 禁用模糊搜索（精确 glob 匹配）
const files = await window.api.file.listDirectory(dirPath, {
  searchPattern: 'update',
  fuzzy: false
})
```

## 性能考虑

1. **Ripgrep 预过滤**：大多数查询由 ripgrep 的原生 glob 匹配处理，速度极快
2. **仅在需要时回退**：贪婪子串匹配（加载所有文件）仅在 glob 匹配返回空结果时运行
3. **结果限制**：默认只返回前 20 个结果
4. **排除目录**：自动排除常见的大型目录：
   - `node_modules`
   - `.git`
   - `dist`、`build`
   - `.next`、`.nuxt`
   - `coverage`、`.cache`

## 实现细节

实现位于 `src/main/services/FileStorage.ts`：

- `queryToGlobPattern()`：将查询转换为 ripgrep glob 模式
- `isFuzzyMatch()`：子序列匹配算法
- `isGreedySubstringMatch()`：贪婪子串匹配回退
- `getFuzzyMatchScore()`：计算相关性分数
- `listDirectoryWithRipgrep()`：主搜索协调
