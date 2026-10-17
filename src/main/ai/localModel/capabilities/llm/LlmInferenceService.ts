import path from 'node:path'

import { application } from '@application'
import { Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { LocalModelBundleId } from '@shared/data/presets/localModel'

import { bundleFile, getModelBundle } from '../../catalog/catalog'
import { localModelStorageService } from '../../installation/LocalModelStorageService'
import { InferenceServiceBase } from '../../runtime/InferenceServiceBase'
import type {
  LlmGenerateEvent,
  LlmGenerateInput,
  LlmGenerateResult,
  LlmInferenceContract,
  LlmInitData
} from './protocol'

export const llmInferenceProcess = defineUtilityProcess<LlmInferenceContract, LlmInitData>({
  id: 'inference.llm',
  entry: 'inference-llm',
  // Generation stops at the next token on abort; terminating would also drop the loaded model.
  cancellation: 'cooperative',
  // Agent turns pause for tool execution; reloading the weights after each pause costs seconds.
  idleTimeoutMs: 10 * 60_000,
  createInitData: () => ({
    appPath: application.getPath('app.root'),
    // The addon sits in `<binsDir>/<platform folder>/`, the layout the node-llama-cpp loader expects.
    binsDir: path.dirname(path.dirname(localModelStorageService.artifactPath('node-llama-cpp')))
  })
})

@Injectable('LlmInferenceService')
@ServicePhase(Phase.WhenReady)
export class LlmInferenceService extends InferenceServiceBase<LlmInferenceContract> {
  constructor() {
    super(llmInferenceProcess, 'llm')
  }

  async generate(
    modelId: LocalModelBundleId,
    input: LlmGenerateInput,
    options: { signal?: AbortSignal; onEvent: (event: LlmGenerateEvent) => void }
  ): Promise<LlmGenerateResult> {
    return this.run(
      modelId,
      'generate',
      () => {
        const bundle = getModelBundle(modelId)
        const runtime = bundle.runtime?.chat
        if (bundle.capability !== 'llm' || !runtime) throw new Error(`${modelId} is not a local chat model`)
        const modelDir = localModelStorageService.resolveInstalledDir(bundle)
        if (!modelDir || !bundle.requires.every((id) => localModelStorageService.isArtifactReady(id)))
          throw new Error('The selected local chat model is not fully downloaded')
        return { ...input, modelPath: path.join(modelDir, bundleFile(bundle, 'weights').relPath), runtime }
      },
      options
    )
  }
}
