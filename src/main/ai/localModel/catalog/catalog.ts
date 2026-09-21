import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY, type LocalModelBundleId } from '@shared/data/presets/localModel'

import type { ModelBundle, SharedArtifact, SharedArtifactId } from './types'

/**
 * Single source of truth for everything installable locally: which bundles exist,
 * what files they are made of, where those bytes come from and what they must hash
 * to. Data only — fetching lives in `../acquisition`, on-disk state in
 * `../installation/LocalModelStorageService`, mirror resolution in `../acquisition/modelSource`.
 *
 * Adding a model means adding an entry here; nothing else in the subsystem is
 * per-model. See `docs/references/ai/local-models.md` for the checklist.
 *
 * ## Obtaining `sha256`
 * The upstream APIs publish the digest, so no download is needed:
 *   - HuggingFace: `GET /api/models/<repo>/tree/main?recursive=true` → `lfs.oid`
 *     (LFS files only — small files report a git blob SHA-1 instead).
 *   - ModelScope: `GET /api/v1/models/<repo>/repo/files?Revision=master` → `Sha256`.
 * Files with explicit sources below were confirmed byte-identical across the listed
 * immutable revisions, so one digest can safely serve all declared fallbacks.
 */

const ONNXRUNTIME_NODE_TARBALL_SHA256 = '582c44aac00414a5580fe9dcbebcb12c8bf1cc703ab3507203455db842e168f9'

export const SHARED_ARTIFACTS = {
  /** Native onnxruntime binding, downloaded on demand rather than bundled: the npm
   * package carries every platform's binaries, so shipping it would add hundreds of
   * MB to an installer for users who never touch a local model. `dist/binding.js` is
   * patched (patches/onnxruntime-node@1.25.1.patch) to load the copy fetched here via
   * `CHERRY_ONNXRUNTIME_BINDING_PATH`. `version` must match package.json's pin. */
  'onnxruntime-node': {
    id: 'onnxruntime-node',
    version: '1.25.1',
    installDirKey: 'feature.onnxruntime.binary',
    // No darwin-x64: onnxruntime-node ships no binding for it, so both bundles read
    // as `unsupported` on Intel Macs instead of offering a download that cannot work.
    platforms: {
      'darwin-arm64': {
        packageName: 'onnxruntime-node',
        tarballSha256: ONNXRUNTIME_NODE_TARBALL_SHA256,
        tarballPrefix: 'package/bin/napi-v6/darwin/arm64/',
        installSubdir: 'napi-v6/darwin/arm64',
        entryFile: 'onnxruntime_binding.node',
        supportFiles: ['libonnxruntime.1.25.1.dylib']
      },
      'linux-x64': {
        packageName: 'onnxruntime-node',
        tarballSha256: ONNXRUNTIME_NODE_TARBALL_SHA256,
        tarballPrefix: 'package/bin/napi-v6/linux/x64/',
        installSubdir: 'napi-v6/linux/x64',
        entryFile: 'onnxruntime_binding.node',
        supportFiles: ['libonnxruntime.so.1']
      },
      'linux-arm64': {
        packageName: 'onnxruntime-node',
        tarballSha256: ONNXRUNTIME_NODE_TARBALL_SHA256,
        tarballPrefix: 'package/bin/napi-v6/linux/arm64/',
        installSubdir: 'napi-v6/linux/arm64',
        entryFile: 'onnxruntime_binding.node',
        supportFiles: ['libonnxruntime.so.1']
      },
      'win32-x64': {
        packageName: 'onnxruntime-node',
        tarballSha256: ONNXRUNTIME_NODE_TARBALL_SHA256,
        tarballPrefix: 'package/bin/napi-v6/win32/x64/',
        installSubdir: 'napi-v6/win32/x64',
        entryFile: 'onnxruntime_binding.node',
        supportFiles: ['onnxruntime.dll', 'DirectML.dll', 'dxil.dll', 'dxcompiler.dll']
      },
      'win32-arm64': {
        packageName: 'onnxruntime-node',
        tarballSha256: ONNXRUNTIME_NODE_TARBALL_SHA256,
        tarballPrefix: 'package/bin/napi-v6/win32/arm64/',
        installSubdir: 'napi-v6/win32/arm64',
        entryFile: 'onnxruntime_binding.node',
        supportFiles: ['onnxruntime.dll', 'DirectML.dll', 'dxil.dll', 'dxcompiler.dll']
      }
    }
  },
  'sherpa-onnx': {
    id: 'sherpa-onnx',
    version: '1.13.6',
    installDirKey: 'feature.sherpa_onnx.binary',
    provenance: {
      license: {
        spdx: 'Apache-2.0',
        url: 'https://github.com/k2-fsa/sherpa-onnx/blob/1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911/LICENSE'
      },
      upstream: {
        url: 'https://github.com/k2-fsa/sherpa-onnx',
        revision: '1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911'
      }
    },
    platforms: {
      'darwin-arm64': {
        packageName: 'sherpa-onnx-darwin-arm64',
        tarballSha256: '213f438edec89d2adc85861a4377ee9620e5dd602db079252530637e79a325ab',
        tarballPrefix: 'package/',
        installSubdir: 'darwin/arm64',
        entryFile: 'sherpa-onnx.node',
        supportFiles: ['libsherpa-onnx-c-api.dylib', 'libsherpa-onnx-cxx-api.dylib', 'libonnxruntime.dylib']
      },
      'darwin-x64': {
        packageName: 'sherpa-onnx-darwin-x64',
        tarballSha256: 'd8a60dd2656a81281235f2315dc6ff623257446c187f2b43fd6cb32daf45fbda',
        tarballPrefix: 'package/',
        installSubdir: 'darwin/x64',
        entryFile: 'sherpa-onnx.node',
        supportFiles: ['libsherpa-onnx-c-api.dylib', 'libsherpa-onnx-cxx-api.dylib', 'libonnxruntime.dylib']
      },
      'linux-x64': {
        packageName: 'sherpa-onnx-linux-x64',
        tarballSha256: '9aeb779dc87702db2640cbb29c097ac0585a34ecbc5b1c72f056903e2d74d7d5',
        tarballPrefix: 'package/',
        installSubdir: 'linux/x64',
        entryFile: 'sherpa-onnx.node',
        supportFiles: ['libsherpa-onnx-c-api.so', 'libsherpa-onnx-cxx-api.so', 'libonnxruntime.so']
      },
      'linux-arm64': {
        packageName: 'sherpa-onnx-linux-arm64',
        tarballSha256: '14479ecdf502b36c49281c0eb2cfde43c406309039e49d124aee30761f436fbf',
        tarballPrefix: 'package/',
        installSubdir: 'linux/arm64',
        entryFile: 'sherpa-onnx.node',
        supportFiles: ['libsherpa-onnx-c-api.so', 'libsherpa-onnx-cxx-api.so', 'libonnxruntime.so']
      },
      'win32-x64': {
        packageName: 'sherpa-onnx-win-x64',
        tarballSha256: '3efca85485f3d56c09b62912d473e15b583a831d9541ed91c6fdab08e713025d',
        tarballPrefix: 'package/',
        installSubdir: 'win32/x64',
        entryFile: 'sherpa-onnx.node',
        supportFiles: [
          'onnxruntime_providers_shared.dll',
          'onnxruntime.dll',
          'sherpa-onnx-c-api.dll',
          'sherpa-onnx-cxx-api.dll'
        ]
      }
    }
  }
} as const satisfies Record<SharedArtifactId, SharedArtifact>

export const LOCAL_MODEL_BUNDLES = {
  /** Text embedding for the knowledge base. The four files are what transformers.js
   * needs to load the q8 weights offline; the repo's other quantizations are not fetched. */
  'qwen3-embedding-0.6b': {
    id: 'qwen3-embedding-0.6b',
    capability: 'embedding',
    installDirKey: 'feature.embedding.models',
    // transformers.js loads a model from the directory holding its config.json, and
    // earlier releases let it name that directory after the repo. Keeping the same layout
    // is what lets existing installs upgrade without re-fetching 614MB.
    installSubdir: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    // ModelScope downloads used to nest one more level, because transformers.js appends
    // any revision that is not `main`.
    legacyInstallSubdir: 'onnx-community/Qwen3-Embedding-0.6B-ONNX/master',
    requires: ['onnxruntime-node'],
    runtime: { dtype: 'q8' },
    files: [
      {
        key: 'config',
        relPath: 'config.json',
        repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
        remoteFile: 'config.json',
        sha256: '66a10929782f3c9a3cd5dec90e2a95c60e05736134a63cd54479eeae80bed175',
        minBytes: 500,
        weight: 1
      },
      {
        key: 'tokenizerConfig',
        relPath: 'tokenizer_config.json',
        repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
        remoteFile: 'tokenizer_config.json',
        sha256: '977648852447cb6587327ff3205b0a84cf2fc9f05621d6c8e88a497caafab2e1',
        minBytes: 1_000,
        weight: 1
      },
      {
        key: 'tokenizer',
        relPath: 'tokenizer.json',
        repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
        remoteFile: 'tokenizer.json',
        sha256: 'def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a',
        minBytes: 1_000_000,
        weight: 11
      },
      {
        key: 'weights',
        // Nested under `onnx/` because transformers.js resolves a model's weights
        // relative to the directory holding config.json.
        relPath: 'onnx/model_quantized.onnx',
        repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
        remoteFile: 'onnx/model_quantized.onnx',
        sha256: '87cd124e0ef1fd1f223ebc283efccbaeac386d0b08344701c46975d0657b591f',
        minBytes: 100_000_000,
        weight: 585
      }
    ]
  },
  /** PaddleOCR PP-OCRv6 medium — detection + recognition weights plus the character
   * dictionary parsed out of the recognition model's config. */
  'pp-ocrv6-medium': {
    id: 'pp-ocrv6-medium',
    capability: 'ocr',
    installDirKey: 'feature.ocr.paddleocr',
    requires: ['onnxruntime-node'],
    files: [
      {
        key: 'detection',
        relPath: 'PP-OCRv6_medium_det.onnx',
        repo: 'PaddlePaddle/PP-OCRv6_medium_det_onnx',
        remoteFile: 'inference.onnx',
        sha256: 'eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1',
        minBytes: 1_000_000,
        weight: 59
      },
      {
        key: 'recognition',
        relPath: 'PP-OCRv6_medium_rec.onnx',
        repo: 'PaddlePaddle/PP-OCRv6_medium_rec_onnx',
        remoteFile: 'inference.onnx',
        sha256: '9c09abf0957f7968c7586464b7397b84ad2387a0497a351af40e9acc71b673ba',
        minBytes: 1_000_000,
        weight: 73
      },
      {
        // The `*_onnx` repos publish no standalone dictionary — it is embedded in the
        // recognition model's `inference.yml` under `PostProcess.character_dict`, so
        // the fetched config is parsed into the ~75KB file ppu-paddle-ocr reads.
        key: 'dictionary',
        relPath: 'ppocrv6_dict.txt',
        repo: 'PaddlePaddle/PP-OCRv6_medium_rec_onnx',
        remoteFile: 'inference.yml',
        sha256: '991b700facf5b50a7de193468207d5f4255b538dde0d312ae3b7c7a9b6873129',
        minBytes: 10_000,
        weight: 1,
        derivation: 'paddle_dict_from_inference_yml'
      }
    ]
  },
  'funasr-nano-int8': {
    id: 'funasr-nano-int8',
    capability: 'asr',
    installDirKey: 'feature.asr.funasr',
    requires: ['sherpa-onnx'],
    provenance: {
      license: {
        spdx: 'Apache-2.0',
        url: 'https://github.com/FunAudioLLM/Fun-ASR/blob/272c57b82523ada6fd87095e955f8e29100979ab/LICENSE'
      },
      upstream: {
        url: 'https://github.com/FunAudioLLM/Fun-ASR',
        revision: '272c57b82523ada6fd87095e955f8e29100979ab'
      },
      conversion: {
        url: 'https://www.modelscope.cn/models/zengshuishui/FunASR-nano-onnx',
        revision: '2f25d8e45c1534925cda6a4977d497f383b01535',
        license: {
          spdx: 'Apache-2.0',
          url: 'https://www.modelscope.cn/models/zengshuishui/FunASR-nano-onnx'
        }
      }
    },
    files: [
      {
        key: 'encoder',
        relPath: 'encoder_adaptor.int8.onnx',
        sha256: 'f36dea2e30fbc33b5db1d7a7265cc976c5e5586c77b042d5adb1ad27c72db422',
        sizeBytes: 237_792_748,
        minBytes: 150_000_000,
        weight: 238,
        sources: [
          {
            source: 'huggingface',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'encoder_adaptor.int8.onnx'
          },
          {
            source: 'hf-mirror',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'encoder_adaptor.int8.onnx'
          },
          {
            source: 'modelscope',
            repo: 'zengshuishui/FunASR-nano-onnx',
            revision: '2f25d8e45c1534925cda6a4977d497f383b01535',
            remoteFile: 'encoder_adaptor.int8.onnx'
          }
        ]
      },
      {
        key: 'llm',
        relPath: 'llm.int8.onnx',
        sha256: 'dfbf9aa3be41bccc257587f151e15c63fbe1b549f2b517f5ccd5bdce3bf4322a',
        sizeBytes: 600_356_593,
        minBytes: 400_000_000,
        weight: 600,
        sources: [
          {
            source: 'huggingface',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'llm.int8.onnx'
          },
          {
            source: 'hf-mirror',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'llm.int8.onnx'
          },
          {
            source: 'modelscope',
            repo: 'zengshuishui/FunASR-nano-onnx',
            revision: '2f25d8e45c1534925cda6a4977d497f383b01535',
            remoteFile: 'llm_int8/llm.int8.onnx'
          }
        ]
      },
      {
        key: 'embedding',
        relPath: 'embedding.int8.onnx',
        sha256: '95e61cd0c9c3b9543339a4cf973c95c116815e745ccc1e0285cbd81f76d18644',
        sizeBytes: 155_584_380,
        minBytes: 100_000_000,
        weight: 156,
        sources: [
          {
            source: 'huggingface',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'embedding.int8.onnx'
          },
          {
            source: 'hf-mirror',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'embedding.int8.onnx'
          },
          {
            source: 'modelscope',
            repo: 'zengshuishui/FunASR-nano-onnx',
            revision: '2f25d8e45c1534925cda6a4977d497f383b01535',
            remoteFile: 'embedding.int8.onnx'
          }
        ]
      },
      {
        key: 'tokenizerVocab',
        relPath: 'Qwen3-0.6B/tokenizer.json',
        sha256: 'aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4',
        sizeBytes: 11_422_654,
        minBytes: 5_000_000,
        weight: 11,
        sources: [
          {
            source: 'huggingface',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'Qwen3-0.6B/tokenizer.json'
          },
          {
            source: 'hf-mirror',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'Qwen3-0.6B/tokenizer.json'
          },
          {
            source: 'modelscope',
            repo: 'zengshuishui/FunASR-nano-onnx',
            revision: '2f25d8e45c1534925cda6a4977d497f383b01535',
            remoteFile: 'Qwen3-0.6B/tokenizer.json'
          }
        ]
      },
      {
        key: 'tokenizerBpeVocab',
        relPath: 'Qwen3-0.6B/vocab.json',
        sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910',
        sizeBytes: 2_776_833,
        minBytes: 1_000_000,
        weight: 3,
        sources: [
          {
            source: 'huggingface',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'Qwen3-0.6B/vocab.json'
          },
          {
            source: 'hf-mirror',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'Qwen3-0.6B/vocab.json'
          },
          {
            source: 'modelscope',
            repo: 'zengshuishui/FunASR-nano-onnx',
            revision: '2f25d8e45c1534925cda6a4977d497f383b01535',
            remoteFile: 'Qwen3-0.6B/vocab.json'
          }
        ]
      },
      {
        key: 'tokenizerBpeMerges',
        relPath: 'Qwen3-0.6B/merges.txt',
        sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5',
        sizeBytes: 1_671_853,
        minBytes: 500_000,
        weight: 2,
        sources: [
          {
            source: 'huggingface',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'Qwen3-0.6B/merges.txt'
          },
          {
            source: 'hf-mirror',
            repo: 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30',
            revision: '6f16bd378457e13f36ccf3910df9017f96c346fb',
            remoteFile: 'Qwen3-0.6B/merges.txt'
          },
          {
            source: 'modelscope',
            repo: 'zengshuishui/FunASR-nano-onnx',
            revision: '2f25d8e45c1534925cda6a4977d497f383b01535',
            remoteFile: 'Qwen3-0.6B/merges.txt'
          }
        ]
      },
      {
        key: 'voiceActivityDetector',
        relPath: 'silero_vad.onnx',
        sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
        sizeBytes: 1_807_522,
        minBytes: 1_000_000,
        weight: 2,
        sources: [
          {
            source: 'huggingface',
            repo: 'csukuangfj/vad',
            revision: 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc',
            remoteFile: 'silero_vad.onnx'
          },
          {
            source: 'hf-mirror',
            repo: 'csukuangfj/vad',
            revision: 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc',
            remoteFile: 'silero_vad.onnx'
          }
        ]
      }
    ]
  }
} as const satisfies Record<LocalModelBundleId, ModelBundle>

export const ALL_MODEL_BUNDLE_IDS = Object.keys(LOCAL_MODEL_BUNDLES) as readonly LocalModelBundleId[]

export function getModelBundle(id: LocalModelBundleId): ModelBundle {
  return LOCAL_MODEL_BUNDLES[id]
}

export function getSharedArtifact(id: SharedArtifactId): SharedArtifact {
  return SHARED_ARTIFACTS[id]
}

/** The one bundle serving a capability. Throws rather than returning undefined:
 * a capability with no bundle is a catalog bug, not a runtime condition. */
export function bundleForCapability(capability: ModelBundle['capability']): ModelBundle {
  return getModelBundle(LOCAL_MODEL_BUNDLE_BY_CAPABILITY[capability])
}

/** The transformers.js quantization selector for a bundle's weights. Throws when the
 * bundle declares none, which for a bundle loaded through transformers.js is a catalog
 * bug — the alternative is silently loading a different quantization than was downloaded. */
export function bundleDtype(bundle: ModelBundle): string {
  const dtype = bundle.runtime?.dtype
  if (!dtype) throw new Error(`bundle "${bundle.id}" declares no runtime dtype`)
  return dtype
}

/** One file of a bundle by its stable {@link BundleFile.key}. Throws on an unknown key
 * so a renamed file surfaces at the call site instead of as a silent `undefined` path. */
export function bundleFile(bundle: ModelBundle, key: string): ModelBundle['files'][number] {
  const file = bundle.files.find((entry) => entry.key === key)
  if (!file) throw new Error(`bundle "${bundle.id}" has no file with key "${key}"`)
  return file
}
