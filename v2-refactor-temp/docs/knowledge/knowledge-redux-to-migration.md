# knowledge redux usage (renderer)

> **迁移追踪文档**
>
> 本文档追踪 Renderer 进程中仍在使用 `@renderer/store/knowledge` 的文件。
> 目标是将这些依赖迁移到 DataApi 架构。

## 直接依赖 (仍使用 Redux)

- `src/renderer/src/store/thunk/__tests__/knowledgeThunk.test.ts` (imports actions; mocks module)
- `src/renderer/src/store/thunk/knowledgeThunk.ts` (imports `addFiles`/`addItem`/`updateNotes`)
- `src/renderer/src/services/__tests__/ApiService.test.ts` (mocks module)
- `src/renderer/src/hooks/useKnowledge.ts` (imports actions)
- `src/renderer/src/hooks/usePreprocess.ts` (imports `syncPreprocessProvider`)

## 间接依赖 (通过 hooks/thunks)

- via `@renderer/hooks/useKnowledge`
  - `src/renderer/src/pages/home/Inputbar/tools/components/AttachmentButton.tsx`
  - `src/renderer/src/components/Popups/SaveToKnowledgePopup.tsx`
- via `@renderer/hooks/useKnowledgeFiles`
  - `src/renderer/src/pages/settings/DataSettings/DataSettings.tsx`
- via `@renderer/hooks/usePreprocess`
  - `src/renderer/src/pages/knowledge/KnowledgeContent.tsx`
  - `src/renderer/src/pages/knowledge/components/KnowledgeSearchPopup.tsx`
  - `src/renderer/src/pages/knowledge/components/QuotaTag.tsx`
  - `src/renderer/src/pages/knowledge/components/EditKnowledgeBasePopup.tsx`
  - `src/renderer/src/pages/settings/DocProcessSettings/PreprocessSettings.tsx`
  - `src/renderer/src/pages/settings/DocProcessSettings/PreprocessProviderSettings.tsx`
  - `src/renderer/src/components/Popups/ApiKeyListPopup/list.tsx`
- via `knowledgeThunk`
  - `src/renderer/src/store/thunk/__tests__/knowledgeThunk.test.ts`

---

## Main 进程依赖

> **注意**: Main 进程中的 `KnowledgeProviderAdapter` 目前依赖 `reduxService` 获取 Provider 配置。
> 待 Provider 数据迁移到 DataApi 后需要一并更新。

- `src/main/services/knowledge/KnowledgeProviderAdapter.ts` (uses `reduxService.select`)

---

## 相关文档

- [Knowledge DataApi 设计](./knowledge-data-api.md) - 迁移目标架构
- [Knowledge 数据迁移方案](./knowledge-data-migration.md) - 迁移流程
