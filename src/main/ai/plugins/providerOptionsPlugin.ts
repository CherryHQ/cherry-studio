/**
 * Provider-options plugin (capability-driven).
 *
 * Writes the per-provider `providerOptions` blob — reasoning effort, service
 * tier, verbosity, generate-image flags — derived from
 * `(assistant, model, provider, capabilities)`. Delegates to
 * `buildCapabilityProviderOptions` in `utils/options.ts`.
 *
 * Does NOT touch user-supplied `customParameters` — that's the
 * `customParametersPlugin`'s job, which runs after this one and layers on top
 * of whatever this plugin (and any later capability plugins like
 * `anthropicCachePlugin`) wrote.
 *
 * Enforce = 'pre' so the base providerOptions land before
 * `customParametersPlugin` reads them.
 */

import { type AiPlugin, definePlugin, type StreamTextParams, type StreamTextResult } from '@cherrystudio/ai-core'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { ResolvedCapabilities } from '../capabilities'
import { buildCapabilityProviderOptions } from '../utils/options'

export interface ProviderOptionsPluginConfig {
  assistant: Assistant
  model: Model
  provider: Provider
  capabilities: Pick<ResolvedCapabilities, 'enableReasoning' | 'enableWebSearch' | 'enableGenerateImage'>
}

export const createProviderOptionsPlugin = ({
  assistant,
  model,
  provider,
  capabilities
}: ProviderOptionsPluginConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'provider-options',
    enforce: 'pre',
    transformParams: (params) => {
      const built = buildCapabilityProviderOptions(assistant, model, provider, capabilities)
      // Shallow-merge per provider key. Preserve anything other plugins (or
      // the caller) already put on `params.providerOptions`.
      const existing = params.providerOptions ?? {}
      const mergedProviderOptions: Record<string, Record<string, unknown>> = { ...existing }
      for (const [providerId, opts] of Object.entries(built)) {
        mergedProviderOptions[providerId] = { ...(existing[providerId] ?? {}), ...opts }
      }
      return { providerOptions: mergedProviderOptions } as Partial<StreamTextParams>
    }
  })
