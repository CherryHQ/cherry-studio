# WebSearch 数据迁移指南

本文档描述 WebSearch 从 Redux 迁移到 Preference 系统的数据迁移方案。

## 迁移概览

### 数据源

- **来源**: Redux Store (`redux.websearch`)
- **目标**: Preference 系统 (`chat.websearch.*`)

### 迁移类型

| 类型     | 说明           | 数量                     |
| -------- | -------------- | ------------------------ |
| 简单映射 | 一对一字段映射 | 4 项                     |
| 复杂映射 | 需要扁平化转换 | 1 项 (compressionConfig) |
| 丢弃     | 不需要迁移     | 3 项                     |

---

## 简单映射

以下字段通过 `PreferencesMappings.ts` 自动迁移：

| 原始字段         | 目标 Key                          | 类型                  |
| ---------------- | --------------------------------- | --------------------- |
| `providers`      | `chat.websearch.providers`        | `WebSearchProvider[]` |
| `searchWithTime` | `chat.websearch.search_with_time` | `boolean`             |
| `maxResults`     | `chat.websearch.max_results`      | `number`              |
| `excludeDomains` | `chat.websearch.exclude_domains`  | `string[]`            |

### 生成命令

```bash
cd v2-refactor-temp/tools/data-classify
npm run generate:migration
```

生成后 `PreferencesMappings.ts` 将包含：

```typescript
websearch: [
  { originalKey: "providers", targetKey: "chat.websearch.providers" },
  {
    originalKey: "searchWithTime",
    targetKey: "chat.websearch.search_with_time",
  },
  { originalKey: "maxResults", targetKey: "chat.websearch.max_results" },
  {
    originalKey: "excludeDomains",
    targetKey: "chat.websearch.exclude_domains",
  },
];
```

---

## 复杂映射: compressionConfig

### 问题描述

旧版本 `compressionConfig` 是嵌套对象，新版本需要扁平化为多个独立的 Preference key。

### 转换规则

```typescript
// 旧格式 (Redux websearch.compressionConfig)
interface WebSearchCompressionConfig {
  method: 'none' | 'cutoff' | 'rag'
  cutoffLimit: number | null
  cutoffUnit: 'char' | 'token'
  documentCount: number
  embeddingModel: Model | null      // 完整 Model 对象，包含 id, provider 等
  embeddingDimensions: number | null
  rerankModel: Model | null         // 完整 Model 对象，包含 id, provider 等
}

// 新格式 (Preference 扁平化)
'chat.websearch.compression.method': 'none' | 'cutoff' | 'rag'
'chat.websearch.compression.cutoff_limit': number | null
'chat.websearch.compression.cutoff_unit': 'char' | 'token'
'chat.websearch.compression.rag_document_count': number
'chat.websearch.compression.rag_embedding_model_id': string | null
'chat.websearch.compression.rag_embedding_provider_id': string | null
'chat.websearch.compression.rag_embedding_dimensions': number | null
'chat.websearch.compression.rag_rerank_model_id': string | null
'chat.websearch.compression.rag_rerank_provider_id': string | null
```

### 实现步骤

#### 1. 添加转换函数

文件: `src/main/data/migration/v2/migrators/transformers/PreferenceTransformers.ts`

```typescript
/**
 * Flatten compressionConfig object into separate preference keys
 */
export function flattenCompressionConfig(sources: {
  compressionConfig?: {
    method?: string;
    cutoffLimit?: number | null;
    cutoffUnit?: string;
    documentCount?: number;
    embeddingModel?: { id?: string; provider?: string } | null;
    embeddingDimensions?: number | null;
    rerankModel?: { id?: string; provider?: string } | null;
  };
}): TransformResult {
  const config = sources.compressionConfig;

  // If no config, return defaults
  if (!config) {
    return {
      "chat.websearch.compression.method": "none",
      "chat.websearch.compression.cutoff_limit": null,
      "chat.websearch.compression.cutoff_unit": "char",
      "chat.websearch.compression.rag_document_count": 5,
      "chat.websearch.compression.rag_embedding_model_id": null,
      "chat.websearch.compression.rag_embedding_provider_id": null,
      "chat.websearch.compression.rag_embedding_dimensions": null,
      "chat.websearch.compression.rag_rerank_model_id": null,
      "chat.websearch.compression.rag_rerank_provider_id": null,
    };
  }

  return {
    "chat.websearch.compression.method": config.method ?? "none",
    "chat.websearch.compression.cutoff_limit": config.cutoffLimit ?? null,
    "chat.websearch.compression.cutoff_unit": config.cutoffUnit ?? "char",
    "chat.websearch.compression.rag_document_count": config.documentCount ?? 5,
    "chat.websearch.compression.rag_embedding_model_id":
      config.embeddingModel?.id ?? null,
    "chat.websearch.compression.rag_embedding_provider_id":
      config.embeddingModel?.provider ?? null,
    "chat.websearch.compression.rag_embedding_dimensions":
      config.embeddingDimensions ?? null,
    "chat.websearch.compression.rag_rerank_model_id":
      config.rerankModel?.id ?? null,
    "chat.websearch.compression.rag_rerank_provider_id":
      config.rerankModel?.provider ?? null,
  };
}
```

#### 2. 添加映射配置

文件: `src/main/data/migration/v2/migrators/mappings/ComplexPreferenceMappings.ts`

```typescript
import { flattenCompressionConfig } from "../transformers/PreferenceTransformers";

export const COMPLEX_PREFERENCE_MAPPINGS: ComplexMapping[] = [
  {
    id: "websearch_compression_flatten",
    description:
      "Flatten websearch compressionConfig object into separate preference keys",
    sources: {
      compressionConfig: {
        source: "redux",
        category: "websearch",
        key: "compressionConfig",
      },
    },
    targetKeys: [
      "chat.websearch.compression.method",
      "chat.websearch.compression.cutoff_limit",
      "chat.websearch.compression.cutoff_unit",
      "chat.websearch.compression.rag_document_count",
      "chat.websearch.compression.rag_embedding_model_id",
      "chat.websearch.compression.rag_embedding_provider_id",
      "chat.websearch.compression.rag_embedding_dimensions",
      "chat.websearch.compression.rag_rerank_model_id",
      "chat.websearch.compression.rag_rerank_provider_id",
    ],
    transform: flattenCompressionConfig,
  },
];
```

---

## 丢弃字段

以下字段在新版本中不再需要，设置 `targetKey: null`：

| 原始字段           | 原因                     |
| ------------------ | ------------------------ |
| `defaultProvider`  | 被 provider 选择 UI 替代 |
| `subscribeSources` | 功能废弃                 |
| `enhanceMode`      | 功能废弃或合并到其他配置 |

---

## 验证清单

- [ ] 运行 `npm run generate:migration` 生成简单映射
- [ ] 实现 `flattenCompressionConfig` 转换函数
- [ ] 添加 `COMPLEX_PREFERENCE_MAPPINGS` 配置
- [ ] 运行 `npm run validate:gen` 验证生成代码
- [ ] 运行 `pnpm build:check` 确保构建通过
- [ ] 测试迁移流程

---

## 相关文件

| 文件                                                                          | 说明                 |
| ----------------------------------------------------------------------------- | -------------------- |
| `v2-refactor-temp/tools/data-classify/data/classification.json`               | 分类配置源           |
| `src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts`        | 简单映射（自动生成） |
| `src/main/data/migration/v2/migrators/mappings/ComplexPreferenceMappings.ts`  | 复杂映射配置         |
| `src/main/data/migration/v2/migrators/transformers/PreferenceTransformers.ts` | 转换函数             |
| `packages/shared/data/preference/preferenceSchemas.ts`                        | Preference Schema    |
| `packages/shared/data/preference/preferenceTypes.ts`                          | 类型定义             |
