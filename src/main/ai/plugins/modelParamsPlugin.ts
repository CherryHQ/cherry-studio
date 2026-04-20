/**
 * Model-parameter plugin.
 *
 * Applies `temperature` / `topP` / `maxOutputTokens` to the request params
 * using the capability-aware helpers in `utils/modelParameters.ts`.
 *
 * Replaces the naive inline merge that `AiService.buildAgentParams` used to
 * do: the plugin version knows about per-model quirks like Claude reasoning
 * disabling temperature, `isMaxTemperatureOneModel` clamping, mutually
 * exclusive temperature/topP, Claude thinking-token budget subtraction, and
 * Claude reasoning topP clamping to [0.95, 1].
 *
 * Enforce = 'pre' so we write the base parameter values first; later plugins
 * (qwenThinking, openrouterReasoning, etc.) can still mutate `providerOptions`
 * without fighting us over temperature.
 */

import { type AiPlugin, definePlugin, type StreamTextParams, type StreamTextResult } from '@cherrystudio/ai-core'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { getMaxTokens, getTemperature, getTopP } from '../utils/modelParameters'

export interface ModelParamsPluginConfig {
  assistant: Assistant
  model: Model
  provider: Provider
}

export const createModelParamsPlugin = ({
  assistant,
  model,
  provider
}: ModelParamsPluginConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'model-params',
    enforce: 'pre',
    transformParams: (params) => {
      const temperature = getTemperature(assistant, model)
      const topP = getTopP(assistant, model)
      const maxOutputTokens = getMaxTokens(assistant, model, provider)

      if (temperature !== undefined) params.temperature = temperature
      if (topP !== undefined) params.topP = topP
      if (maxOutputTokens !== undefined) params.maxOutputTokens = maxOutputTokens
      return params
    }
  })
