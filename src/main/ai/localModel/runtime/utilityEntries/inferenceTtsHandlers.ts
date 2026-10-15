import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type * as MlxTtsRuntime from '@cherrystudio/mlx-tts'
import type { TtsModel } from '@cherrystudio/mlx-tts'
import type { TtsInferenceContract, TtsInitData } from '@main/ai/localModel/capabilities/tts/protocol'
import type { UtilityProcessHandlers } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

let appPath: string
let runtime: typeof MlxTtsRuntime | undefined
let cached: { modelDir: string; model: TtsModel } | undefined

export function initializeTts(data: TtsInitData): void {
  appPath = data.appPath
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = data.bindingPath
}

export async function disposeTts(): Promise<void> {
  const previous = cached
  cached = undefined
  await previous?.model.dispose()
}

async function loadModel(modelDir: string): Promise<TtsModel> {
  if (cached?.modelDir === modelDir) return cached.model
  await disposeTts()
  try {
    runtime ??= (await import(
      pathToFileURL(createRequire(`${appPath}/`).resolve('@cherrystudio/mlx-tts')).href
    )) as typeof MlxTtsRuntime
    const model = await runtime.loadTtsModel(modelDir)
    cached = { modelDir, model }
    return model
  } catch (cause) {
    throw Object.assign(new Error('Speech model initialization failed', { cause }), { code: 'TTS_MODEL_LOAD_FAILED' })
  }
}

export const ttsHandlers: UtilityProcessHandlers<TtsInferenceContract> = {
  async synthesize(input, { signal }) {
    const model = await loadModel(input.modelDir)
    signal.throwIfAborted()
    const writer = await runtime!.WavWriter.open(
      input.outputPath,
      model.capabilities.sampleRate,
      model.capabilities.channels
    )
    try {
      const stream = model.synthesizeStream(input.text, {
        voice: input.voice,
        language: input.language,
        signal,
        maxDurationSeconds: 120
      })
      const completed = stream.completed.then(
        (result) => ({ result }),
        (error) => ({ error })
      )
      let samples = 0
      try {
        for await (const chunk of runtime!.changeAudioSpeed(stream, input.speed)) {
          signal.throwIfAborted()
          samples += chunk.samples.length
          if (samples > 300 * chunk.sampleRate * chunk.channels) throw new Error('Speech output exceeds five minutes')
          await writer.write(chunk)
        }
        const outcome = await completed
        if ('error' in outcome) throw outcome.error
        if (outcome.result.finishReason !== 'eos') throw new Error('Speech output was truncated')
        signal.throwIfAborted()
      } finally {
        stream.cancel()
        await completed
      }
    } finally {
      await writer.close()
    }
  }
}
