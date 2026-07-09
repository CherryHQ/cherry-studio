/**
 * Single source of truth for the downloadable local models the inference host
 * runs — *what* to fetch and from *where*. This module is data only; behavior
 * lives with each domain consumer:
 *   - the embedding AI-SDK adapter + runtime (`ai/provider/custom/localEmbedding`)
 *   - the OCR processor + its on-disk path helpers (`fileProcessing/.../localPaddleocr`)
 *   - the two download services (`services/localModel`)
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
      fileName: 'ppocrv6_dict.txt',
      /** The full yml (thousands of dict entries + model config) is tens of KB;
       * reject anything this small (LFS pointer / truncated response / error page). */
      minBytes: 10_000
    }
  }
} satisfies {
  embedding: { repo: string; dtype: string; readyFile: string }
  ocr: {
    weights: Record<'detection' | 'recognition', RemoteModelFile>
    dictionary: { repo: string; sourceFile: string; fileName: string; minBytes: number }
  }
}

/** Must match package.json's pinned `onnxruntime-node` dependency version. */
export const ONNXRUNTIME_NODE_VERSION = '1.24.3'

/** sha256 of the whole `onnxruntime-node@{ONNXRUNTIME_NODE_VERSION}` npm tarball — the
 * per-platform native binary + shared lib(s) are extracted from this same verified stream,
 * so there is no separate sub-file checksum to track. Regenerate with:
 * `curl -sL https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-{version}.tgz | shasum -a 256` */
export const ONNXRUNTIME_TARBALL_SHA256 = 'aa1bb5fa261ea68de05dd53efbba210cd7adf2d2850f4c3a201054c74cc78040'

/** Platform+arch leaf inside the onnxruntime-node npm tarball; mirrors dist/binding.js's own
 * `bin/napi-v6/${process.platform}/${process.arch}` addressing. */
export interface OnnxRuntimeLeaf {
  binding: string
  sharedLibs: string[]
}

/** No `darwin.x64` entry — onnxruntime-node ships no darwin-x64 binding (see `isDarwinX64`). */
export const ONNXRUNTIME_LEAVES: Record<string, Record<string, OnnxRuntimeLeaf>> = {
  darwin: {
    arm64: { binding: 'onnxruntime_binding.node', sharedLibs: ['libonnxruntime.1.24.3.dylib'] }
  },
  linux: {
    x64: { binding: 'onnxruntime_binding.node', sharedLibs: ['libonnxruntime.so.1'] },
    arm64: { binding: 'onnxruntime_binding.node', sharedLibs: ['libonnxruntime.so.1'] }
  },
  win32: {
    x64: {
      binding: 'onnxruntime_binding.node',
      sharedLibs: ['onnxruntime.dll', 'DirectML.dll', 'dxil.dll', 'dxcompiler.dll']
    },
    arm64: {
      binding: 'onnxruntime_binding.node',
      sharedLibs: ['onnxruntime.dll', 'DirectML.dll', 'dxil.dll', 'dxcompiler.dll']
    }
  }
}
