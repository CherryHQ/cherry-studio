// Curated public surface for the renderer model helpers.
// Named re-exports only (no `export *`) per naming-conventions §5.

export { getModelLogoRef } from './logo'
export {
  canModelUseAssistantWebSearch,
  hasModelBuiltinWebSearch,
  reconcileReasoningEffortForModel,
  reconcileWebSearchForModel,
  resolveReasoningEffortForModel
} from './reconcile'
export { readDefaultModel, readQuickModel, readTranslateModel } from './resolve'
export { getSearchMatchScore } from './search'
export {
  getModelDisplayCapabilityTags,
  getModelDisplayTags,
  isModelTagVisible,
  MODEL_DISPLAY_CAPABILITY_TAGS,
  MODEL_DISPLAY_TAGS,
  type ModelDisplayCapabilityTag,
  type ModelDisplayTag,
  type ModelDisplayTagSource,
  modelMatchesDisplayTag,
  type ModelTagVisibilityOptions
} from './tags'
export { isOpenAIWebSearchModel } from './websearch'
