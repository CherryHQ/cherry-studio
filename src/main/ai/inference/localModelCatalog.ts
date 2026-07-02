/**
 * Single source of truth for the downloadable local models the inference host
 * runs — *what* to fetch and from *where*. This module is data only; behavior
 * lives with each domain consumer:
 *   - the embedding AI-SDK adapter + runtime (`ai/provider/custom/localEmbedding`)
 *   - the OCR processor + its on-disk path helpers (`fileProcessing/.../local-paddleocr`)
 *   - the two download services (`features/localModel`)
 *
 * Mirror resolution (HuggingFace / ModelScope) lives in `./modelSource`.
 */

/** A model weight file fetched from a HuggingFace / ModelScope repo. */
export interface RemoteModelFile {
  /** Repo id, resolved against the locale's mirror at download time. */
  repo: string
  /** Filename within the repo. */
  remoteFile: string
  /** Filename it is saved as under the model dir. */
  fileName: string
  /** Reject smaller downloads (LFS pointers are ~132 bytes; error pages are tiny). */
  minBytes: number
  /** Relative download weight for the aggregate progress bar (≈ file MB). */
  weight: number
}

export const LOCAL_MODELS = {
  /** Text embedding for the knowledge base — transformers.js fetches `repo` itself. */
  embedding: {
    repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    dtype: 'q8',
    /** q8 weights file; its presence under the cache dir marks the model ready. */
    readyFile: 'model_quantized.onnx'
  },
  /** PaddleOCR PP-OCRv6 medium — detection + recognition weights, plus a parsed dict. */
  ocr: {
    /** Official PaddlePaddle ONNX repos; downloaded by the OCR service via the mirror table. */
    weights: {
      detection: {
        repo: 'PaddlePaddle/PP-OCRv6_medium_det_onnx',
        remoteFile: 'inference.onnx',
        fileName: 'PP-OCRv6_medium_det.onnx',
        minBytes: 1_000_000,
        weight: 59
      },
      recognition: {
        repo: 'PaddlePaddle/PP-OCRv6_medium_rec_onnx',
        remoteFile: 'inference.onnx',
        fileName: 'PP-OCRv6_medium_rec.onnx',
        minBytes: 1_000_000,
        weight: 73
      }
    },
    /**
     * Character dictionary. The *_onnx repos don't publish it as a standalone
     * file, but the recognition model's `inference.yml` embeds it under
     * `PostProcess.character_dict` — the OCR download service fetches that yml
     * and parses it out (see LocalOcrDownloadService), saving it as `fileName`.
     * `repo` mirrors the recognition weights' repo.
     */
    dictionary: {
      repo: 'PaddlePaddle/PP-OCRv6_medium_rec_onnx',
      sourceFile: 'inference.yml',
      fileName: 'ppocrv6_dict.txt'
    }
  }
} satisfies {
  embedding: { repo: string; dtype: string; readyFile: string }
  ocr: {
    weights: Record<'detection' | 'recognition', RemoteModelFile>
    dictionary: { repo: string; sourceFile: string; fileName: string }
  }
}
