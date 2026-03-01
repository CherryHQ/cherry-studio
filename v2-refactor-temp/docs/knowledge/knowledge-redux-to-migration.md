# Knowledge Redux 迁移追踪

> **迁移追踪文档**
>
> 本文档追踪仍在使用 Redux/旧架构的文件。
> 目标是将这些依赖迁移到 DataApi 架构。
>
> **最后更新**: 2026-01-18

## 迁移进度概览

| 模块 | 状态 | 说明 |
|------|------|------|
| Knowledge 页面 UI | ✅ 已迁移 | 使用 DataApi hooks |
| Knowledge DataApi | ✅ 已完成 | 8 个端点已实现 |
| Knowledge 服务层 | ✅ 已完成 | 队列、处理器、协调器 |
| 遗留 Redux hooks | ⚠️ 待迁移 | `useKnowledge`、`usePreprocess` |
| Main 进程 Provider | ⚠️ 待迁移 | 依赖 `reduxService` |

---

## Renderer 进程依赖

### 直接依赖 (仍使用 Redux)

| 文件 | 依赖内容 | 迁移优先级 |
|------|----------|------------|
| `src/renderer/src/hooks/useKnowledge.ts` | Redux actions | 🟡 中 |
| `src/renderer/src/hooks/usePreprocess.ts` | `syncPreprocessProvider` | 🟡 中 |
| `src/renderer/src/services/__tests__/ApiService.test.ts` | mocks module | 🟢 低 |

### 间接依赖 (通过 hooks/thunks)

以下文件通过上述 hooks 间接依赖 Redux，当 hooks 迁移后将自动解除依赖：

**via `@renderer/hooks/useKnowledge`:**
- `src/renderer/src/pages/home/Inputbar/tools/components/AttachmentButton.tsx`
- `src/renderer/src/components/Popups/SaveToKnowledgePopup.tsx`

**via `@renderer/hooks/usePreprocess`:**
- 多个 Knowledge 页面组件（已使用 DataApi，仅预处理配置仍走 Redux）
- `src/renderer/src/pages/settings/DocProcessSettings/PreprocessSettings.tsx`
- `src/renderer/src/pages/settings/DocProcessSettings/PreprocessProviderSettings.tsx`
- `src/renderer/src/components/Popups/ApiKeyListPopup/list.tsx`

---

## Main 进程依赖

> **注意**: Main 进程中的 `KnowledgeProviderAdapter` 目前依赖 `reduxService` 获取 Provider 配置。
> 待 Provider 数据迁移到 DataApi 后需要一并更新。

| 文件 | 依赖内容 | 说明 |
|------|----------|------|
| `src/main/services/knowledge/KnowledgeProviderAdapter.ts` | `reduxService.select` | 获取 Provider 配置 |

---

## 已完成的迁移

### ✅ Knowledge 页面 (v2 架构)

Knowledge 页面已完成重构，使用 DataApi 架构：

**新增 DataApi hooks:**
- `src/renderer/src/pages/knowledge/hooks/useKnowledges.ts` - 知识库列表与轮询
- `src/renderer/src/pages/knowledge/hooks/useKnowledgeTabs.tsx` - Tab 配置
- `src/renderer/src/pages/knowledge/hooks/useUpdateKnowledgeBase.tsx` - 更新操作
- `src/renderer/src/pages/knowledge/hooks/useKnowledgeBaseSelection.ts` - 选择状态
- `src/renderer/src/pages/knowledge/hooks/useKnowledgeActions.ts` - 操作动作
- `src/renderer/src/pages/knowledge/hooks/useKnowledgeOrphanQueue.ts` - 孤儿任务

**新增组件结构:**
```
src/renderer/src/pages/knowledge/
├── KnowledgePage.tsx
├── KnowledgeContent.tsx
├── components/
│   ├── KnowledgeSideNav.tsx
│   ├── KnowledgeItemList.tsx
│   ├── KnowledgeItemRow.tsx
│   ├── KnowledgeItemActions.tsx
│   ├── StatusIcon.tsx
│   ├── QuotaTag.tsx
│   ├── AddKnowledgeBaseDialog.tsx
│   ├── EditKnowledgeBaseDialog.tsx
│   ├── KnowledgeSearchDialog.tsx
│   └── KnowledgeSettings/
│       ├── GeneralSettingsPanel.tsx
│       ├── AdvancedSettingsPanel.tsx
│       ├── KnowledgeBaseFormModal.tsx
│       └── KnowledgeBaseFormContainer.tsx
├── hooks/
│   └── (各种 hooks)
└── items/
    ├── KnowledgeFiles.tsx
    ├── KnowledgeNotes.tsx
    ├── KnowledgeUrls.tsx
    ├── KnowledgeSitemaps.tsx
    └── KnowledgeDirectories.tsx
```

---

## 迁移策略

### Phase 1: 遗留 Hooks 迁移 (待执行)

1. **`useKnowledge.ts`** → 迁移到 DataApi
   - `addFiles` → `POST /knowledge-bases/:id/items`
   - `addItem` → `POST /knowledge-bases/:id/items`
   - `updateNotes` → `PATCH /knowledge-items/:id`

2. **`usePreprocess.ts`** → 迁移到 Preference API
   - `syncPreprocessProvider` → Preference 存储

3. **`knowledgeThunk.ts`** → 删除或重构
   - 功能已被 DataApi hooks 替代

### Phase 2: Main 进程 Provider 迁移 (待 Provider DataApi 就绪)

1. **`KnowledgeProviderAdapter.ts`**
   - 改用 DataApi 获取 Provider 配置
   - 依赖 Provider 模块完成 DataApi 迁移

---

## 相关文档

- [Knowledge DataApi 设计](./knowledge-data-api.md) - 迁移目标架构
- [Knowledge 数据迁移方案](./knowledge-data-migration.md) - 迁移流程
