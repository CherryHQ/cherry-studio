/**
 * Shared vocabulary for the downloadable local-model subsystem — the settings
 * download cards and their `local_model.*` IPC. The embedding model/provider
 * identity lives in `localEmbedding.ts`.
 */

/**
 * Download/availability state of a local model, shared by the settings model
 * cards. `unsupported` means *this* model's runtime has no usable build for the
 * current platform/arch, so the card states that instead of offering a download
 * that could only fail. Models can differ: support is per runtime, not per platform.
 */
export const LOCAL_MODEL_STATUSES = ['not_downloaded', 'downloading', 'ready', 'error', 'unsupported'] as const
export type LocalModelStatus = (typeof LOCAL_MODEL_STATUSES)[number]

/** Why a card shows `error`: the last download failed this session, or files on
 * disk exist but cannot form a usable model (e.g. a download interrupted before
 * the last restart). The cards pick their notice text by this code. */
export const LOCAL_MODEL_ERROR_CODES = ['download_failed', 'incomplete_cache'] as const
export type LocalModelErrorCode = (typeof LOCAL_MODEL_ERROR_CODES)[number]

/** Main-owned status projected to every renderer window through Shared Cache. */
export interface LocalModelStatusSnapshot {
  status: LocalModelStatus
  percent: number
  errorCode?: LocalModelErrorCode
}

/** Terminal result returned to every caller awaiting the shared download. */
export const LOCAL_MODEL_DOWNLOAD_RESULTS = ['ready', 'cancelled'] as const
export type LocalModelDownloadResult = (typeof LOCAL_MODEL_DOWNLOAD_RESULTS)[number]

/**
 * What a local model *does*. Features ask for a capability ("this OCR processor
 * needs the ocr model"), never for a specific bundle. Each capability has exactly one
 * bundle; the catalog test enforces that contract.
 */
export const LOCAL_MODEL_CAPABILITIES = ['embedding', 'ocr', 'asr'] as const
export type LocalModelCapability = (typeof LOCAL_MODEL_CAPABILITIES)[number]

/**
 * What a user *installs*: the addressing key of the whole management plane — status,
 * download, cancel, remove and shared status snapshots. Adding a model means adding an
 * id here and a catalog entry beside it, not another IPC route or another card.
 *
 * Kept in sync with `src/main/ai/localModel/catalog/catalog.ts` by construction: the
 * catalog's own bundle-id type is this one, so an unlisted id fails to typecheck.
 */
export const LOCAL_MODEL_BUNDLE_IDS = ['qwen3-embedding-0.6b', 'pp-ocrv6-medium', 'funasr-nano-int8'] as const
export type LocalModelBundleId = (typeof LOCAL_MODEL_BUNDLE_IDS)[number]

export type LocalModelStatusSnapshots = Partial<Record<LocalModelBundleId, LocalModelStatusSnapshot>>
export const LOCAL_MODEL_STATUS_CACHE_KEY = 'local_model.statuses' as const

/**
 * The bundle that serves each capability — how a feature that needs a capability
 * ("this OCR processor needs the ocr model") names the bundle it must install.
 *
 * Shared by main and renderer as the single mapping, and checked against the catalog so
 * the two cannot drift.
 */
export const LOCAL_MODEL_BUNDLE_BY_CAPABILITY = {
  embedding: 'qwen3-embedding-0.6b',
  ocr: 'pp-ocrv6-medium',
  asr: 'funasr-nano-int8'
} as const satisfies Record<LocalModelCapability, LocalModelBundleId>
