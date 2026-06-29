/**
 * Shared vocabulary for the downloadable local-model subsystem (embedding + OCR)
 * — the settings download cards and their `local_model.*` IPC. The embedding
 * model/provider identity lives in `localEmbedding.ts`.
 */

/** Download/availability state of a local model, shared by the settings model cards. */
export const LOCAL_MODEL_STATUSES = ['not_downloaded', 'downloading', 'ready', 'error'] as const
export type LocalModelStatus = (typeof LOCAL_MODEL_STATUSES)[number]

/** Which downloadable local model a settings card / IPC route targets. */
export const LOCAL_MODEL_KINDS = ['embedding', 'ocr'] as const
export type LocalModelKind = (typeof LOCAL_MODEL_KINDS)[number]
