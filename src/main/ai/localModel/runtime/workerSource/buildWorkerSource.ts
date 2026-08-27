import { embeddingWorkerModuleSource } from './embeddingWorkerModule'
import { ocrWorkerModuleSource } from './ocrWorkerModule'
import { workerCoreSource } from './workerCore'

/**
 * Inference worker, shipped as an eval'd `worker_threads` source string: the core followed
 * by one module per capability, concatenated into a single script scope. Adding a
 * capability is a new module plus a line here.
 *
 * Why a string and not a file entry: electron-vite builds the main process as a single
 * bundle (`inlineDynamicImports: true`), which Rollup forbids combining with multiple
 * inputs — so we cannot emit a separate worker chunk. The existing tool-exec worker uses
 * the same string approach. When this host moves to an Electron `utilityProcess` (for crash
 * isolation), these pieces become real modules unchanged — the message protocol and the
 * `InferenceServiceBase` API do not move, and the proxy installer already lives in
 * `@main/services/proxy/workerProxy` so the utilityProcess entry imports it directly
 * instead of baking it in.
 *
 * The worker only `require`s external packages (resolved from node_modules at runtime,
 * since they are externalized from the bundle) and Node built-ins; it never imports project
 * modules. Functions that must be shared with the main process are therefore baked in via
 * `.toString()` at build time — one source, so they cannot drift.
 *
 * The core must come first: the modules call its helpers at registration time.
 *
 * TODO(packaged): the worker resolves `@huggingface/transformers` and `ppu-paddle-ocr` off
 * `app.root`; verify both resolve once the packaged-app build is exercised. The
 * onnxruntime-node native binding is downloaded on demand (not bundled/asarUnpack'd) — see
 * the onnxruntime-node shared artifact in `ai/localModel`.
 */
export const inferenceWorkerSource = [workerCoreSource, embeddingWorkerModuleSource, ocrWorkerModuleSource].join('\n')
