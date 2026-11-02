export {
  CODE_LANGUAGES,
  CODE_THEME_NAMES,
  DEFAULT_LANGUAGES,
  normalizeCodeLanguage,
  resolveCodeTheme,
  supportsCodeLanguage
} from './lib/code-highlight/catalog'
export { loadCodeTheme, getReactStyleFromToken as getTokenStyle } from './lib/code-highlight/theme'
export { createSnapshotExecutor, escapeCode, loadCodeHighlightRuntime, plainTokens } from './lib/code-highlight/runtime'
export type {
  DocumentChange,
  HighlightDocument,
  HighlightRange,
  HighlightResult,
  SnapshotExecutor,
  SnapshotRequest
} from './lib/code-highlight/runtime'
export type { ThemedToken, Theme, TokensResult, LiveTextEdit as TextEdit } from '@pierre/highlights'
