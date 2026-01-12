# knowledge redux usage (renderer)

still using `@renderer/store/knowledge`:

- `src/renderer/src/store/thunk/__tests__/knowledgeThunk.test.ts` (imports actions; mocks module)
- `src/renderer/src/store/thunk/knowledgeThunk.ts` (imports `addFiles`/`addItem`/`updateNotes`)
- `src/renderer/src/services/__tests__/ApiService.test.ts` (mocks module)
- `src/renderer/src/hooks/useKnowledge.ts` (imports actions)
- `src/renderer/src/hooks/usePreprocess.ts` (imports `syncPreprocessProvider`)

indirect usage (imports hooks/thunks that depend on the knowledge store):

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
