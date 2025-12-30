# 文件列表模糊搜索

本文档描述了 Cherry Studio 中文件列表的模糊搜索实现。

## 概述

模糊搜索功能允许用户通过输入部分或近似的文件名/路径来查找文件。它使用两层文件过滤策略（ripgrep glob 预过滤 + 贪婪子串匹配回退），结合基于子序列的评分，以获得最佳性能和灵活性。

## 功能特性

- **Ripgrep Glob 预过滤**：使用 glob 模式进行快速原生级过滤的主要过滤策略
- **贪婪子串匹配**：当 ripgrep glob 预过滤无结果时的回退文件过滤策略
- **基于子序列的段评分**：评分时，当查询字符按顺序出现时，路径段获得额外权重
- **相关性评分**：结果按多因素相关性分数排序

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

结果根据 `FileStorage.ts` 中定义的命名常量进行相关性分数排名：

| 常量 | 值 | 描述 |
|------|-----|------|
| `SCORE_FILENAME_STARTS` | 100 | 文件名以查询开头（最高优先级）|
| `SCORE_FILENAME_CONTAINS` | 80 | 文件名包含精确查询子串 |
| `SCORE_SEGMENT_MATCH` | 60 | 每个匹配查询的路径段 |
| `SCORE_WORD_BOUNDARY` | 20 | 查询匹配单词开头 |
| `SCORE_CONSECUTIVE_CHAR` | 15 | 每个连续字符匹配 |
| `PATH_LENGTH_PENALTY_FACTOR` | 4 | 较长路径的对数惩罚 |

### 评分策略

评分优先级：
1. **文件名匹配**（最高）：查询出现在文件名中的文件最相关
2. **路径段匹配**：多个匹配段表示更强的相关性
3. **词边界**：在单词开头匹配（如 "upd" 匹配 "update"）更优先
4. **连续匹配**：更长的连续字符序列得分更高
5. **路径长度**：较短路径更优先（对数惩罚防止长路径主导评分）

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
