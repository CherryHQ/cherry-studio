import { l2normalize } from './pooling'

/**
 * The embedding capability inside the worker: transformers.js feature extraction, its
 * pipeline cache, and the two requests it answers. Registers itself into the core's
 * `REQUEST_HANDLERS` table — see the runtime worker core for the handler contract.
 */
export const embeddingWorkerSource = `
const embeddingPipelines = new Map() // key: modelDir|dtype -> Promise<extractor>
let transformers = null

function getTransformers() {
  if (!transformers) {
    const { createRequire } = require('node:module')
    const projectRequire = createRequire((appPath || process.cwd()) + '/')
    transformers = projectRequire('@huggingface/transformers')
  }
  return transformers
}

// Injected from pooling.ts (a single, unit-tested source) — the worker never imports
// project modules, so the math is baked in at build time and cannot drift.
const l2normalize = ${l2normalize.toString()}

/**
 * Load the installed model straight off disk. The model id is an absolute directory, which
 * transformers.js rejects as a repo id (isValidHfModelId) — and every remote branch in its
 * resolver is gated on that check, so file discovery cannot reach the network no matter
 * what \\\`revision\\\`/\\\`local_files_only\\\` its internal stages default to. That matters because
 * 4.2.0 drops both options before discovery (get_pipeline_files -> get_files -> get_config /
 * get_tokenizer_files), which is what made a ModelScope-only cache unusable offline.
 */
function getLocalPipeline(modelDir, dtype) {
  return cachedResource(embeddingPipelines, modelDir + '|' + dtype, async () => {
    const { pipeline } = getTransformers()
    const extractor = await pipeline('feature-extraction', modelDir, {
      dtype,
      device: runtimeProfile.transformersDevice,
      session_options: runtimeProfile.embeddingSessionOptions || runtimeProfile.sessionOptions
    })
    if (runtimeProfile.id !== 'cpu') {
      postLog('info', 'hardware provider active provider=' + runtimeProfile.id + ' runtime=embedding')
    }
    return extractor
  })
}

REQUEST_HANDLERS.embed = {
  dispose: () => disposeCached(embeddingPipelines),
  handle: async (msg) => {
    const { modelDir, dtype, texts } = msg.payload
    const extractor = await getLocalPipeline(modelDir, dtype)
    const embeddings = []
    for (const text of texts) {
      // pooling:'none' -> tensor of shape [batch=1, sequence, hidden].
      const output = await extractor(text, { pooling: 'none', normalize: false })
      const seq = output.dims[1]
      const tokens = output.tolist()[0]
      embeddings.push(l2normalize(tokens[seq - 1]))
    }
    postResult(msg, { embeddings })
  }
}

REQUEST_HANDLERS.countTokens = {
  handle: async (msg) => {
    const { modelDir, dtype, texts } = msg.payload
    const extractor = await getLocalPipeline(modelDir, dtype)
    const tokenCounts = texts.map((text) => extractor.tokenizer.encode(text, { add_special_tokens: true }).length)
    postResult(msg, { tokenCounts })
  }
}
`
