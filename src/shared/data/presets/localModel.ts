/**
 * Shared vocabulary for the downloadable local-model subsystem (embedding + OCR)
 * — the settings download cards and their `local_model.*` IPC. The embedding
 * model/provider identity lives in `localEmbedding.ts`.
 */

/**
 * Download/availability state of a local model, shared by the settings model
 * cards. `unsupported` means the current platform/arch can't run inference at
 * all (e.g. Intel Mac — onnxruntime-node ships no darwin-x64 binding); the
 * cards hide rather than offering a download that would fail.
 */
export const LOCAL_MODEL_STATUSES = ['not_downloaded', 'downloading', 'ready', 'error', 'unsupported'] as const
export type LocalModelStatus = (typeof LOCAL_MODEL_STATUSES)[number]

/** Which downloadable local model a settings card / IPC route targets. */
export const LOCAL_MODEL_KINDS = ['embedding', 'ocr'] as const
export type LocalModelKind = (typeof LOCAL_MODEL_KINDS)[number]
