import { aihubmixProvider } from './aihubmixProvider'
import { dmxapiProvider } from './dmxapiProvider'
import { ovmsProvider } from './ovmsProvider'
import { ppioProvider } from './ppioProvider'
import { siliconProvider } from './siliconProvider'
import { tokenFluxProvider } from './tokenFluxProvider'
import type { PaintingProviderDefinition } from './types'
import { zhipuProvider } from './zhipuProvider'

export const providerRegistry: Record<string, PaintingProviderDefinition> = {
  ovms: ovmsProvider,
  ppio: ppioProvider,
  zhipu: zhipuProvider,
  silicon: siliconProvider,
  aihubmix: aihubmixProvider,
  dmxapi: dmxapiProvider,
  tokenflux: tokenFluxProvider
}

export type { GenerateContext, PaintingProviderDefinition } from './types'
