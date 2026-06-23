// Re-export context providers and hooks so existing imports keep working
export type { TranslationOverlayEntry, TranslationOverlaySetter } from './MessagePartsContext'
export {
  parseBlockId,
  PartsProvider,
  RefreshProvider,
  resolvePartFromParts,
  TranslationOverlayProvider,
  TranslationOverlaySetterProvider,
  useHasMessageParts,
  useMessageParts,
  useOptionalTranslationOverlaySetter,
  usePartsMap,
  useRefresh,
  useTranslationOverlay,
  useTranslationOverlayEntry,
  useTranslationOverlaySetter
} from './MessagePartsContext'
