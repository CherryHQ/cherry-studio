import { aihubmixProvider } from './aihubmix'
import { dmxapiProvider } from './dmxapi'
import { ovmsProvider } from './ovms'
import { ppioProvider } from './ppio'
import type { PaintingProvider } from './shared/provider'
import { siliconProvider } from './silicon'
import { tokenFluxProvider } from './tokenflux'
import { zhipuProvider } from './zhipu'

export const providerRegistry: Record<string, PaintingProvider> = {
  ovms: ovmsProvider,
  ppio: ppioProvider,
  zhipu: zhipuProvider,
  silicon: siliconProvider,
  aihubmix: aihubmixProvider,
  dmxapi: dmxapiProvider,
  tokenflux: tokenFluxProvider
}
