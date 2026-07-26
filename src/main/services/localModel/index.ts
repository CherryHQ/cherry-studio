/**
 * Local-model acquisition: on-demand download / removal of the optional local
 * embedding + PaddleOCR models and the shared onnxruntime-node native binary.
 * Public surface only — the subclasses, base, and registration helpers are
 * internal to this module.
 */
export { localEmbeddingDownloadService } from './LocalEmbeddingDownloadService'
export { localOcrDownloadService } from './LocalOcrDownloadService'
export { onnxRuntimeBinaryService } from './OnnxRuntimeBinaryService'
