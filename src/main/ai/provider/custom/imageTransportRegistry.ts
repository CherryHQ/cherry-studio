import type { DashScopeProviderSettings } from './dashscope/dashscopeProvider'
import { dmxapiUsesCustomTransport } from './dmxapi/dmxapiImageRouting'
import type { DmxapiProviderSettings } from './dmxapi/dmxapiProvider'
import type { ImageGenerationTransport } from './imageGenerationModel'

export type NativeImageTransportSettings = Pick<
  DashScopeProviderSettings,
  'apiKey' | 'baseURL' | 'imageBaseURL' | 'headers' | 'fetch'
> &
  Pick<DmxapiProviderSettings, 'endpointBaseURLs'>

export interface ImageTransportConfig {
  providerId: string
  providerSettings: NativeImageTransportSettings
}

interface TransportRegistration {
  supports: (modelId: string) => boolean
  load: (providerSettings: NativeImageTransportSettings) => Promise<ImageGenerationTransport>
  poll?: boolean
  cancel?: boolean
}

function createLazyTransport(
  registration: TransportRegistration,
  providerSettings: NativeImageTransportSettings
): ImageGenerationTransport {
  let transportPromise: Promise<ImageGenerationTransport> | undefined
  const load = () => (transportPromise ??= registration.load(providerSettings))

  return {
    submit: async (input) => (await load()).submit(input),
    ...(registration.poll && {
      poll: async (...args: Parameters<NonNullable<ImageGenerationTransport['poll']>>) => {
        const transport = await load()

        if (!transport.poll) throw new Error('Image transport does not implement polling')

        return transport.poll(...args)
      }
    }),
    ...(registration.cancel && {
      cancel: async (taskId: string) => {
        await (await load()).cancel?.(taskId)
      }
    })
  }
}

const TRANSPORTS: ReadonlyMap<string, TransportRegistration> = new Map(
  Object.entries<TransportRegistration>({
    ppio: {
      supports: () => true,
      poll: true,
      load: async (settings) => {
        const { buildPpioTransport } = await import('./ppio/ppioProvider')

        return buildPpioTransport(settings)
      }
    },
    dashscope: {
      supports: () => true,
      poll: true,
      cancel: true,
      load: async (settings) => {
        const { buildDashScopeTransport } = await import('./dashscope/dashscopeProvider')

        return buildDashScopeTransport(settings)
      }
    },
    // QwenCloud (international) serves the same DashScope AIGC endpoints under
    // its own origin — the transport is identical, only the origin differs
    // (derived into `imageBaseURL` by the provider config builder).
    qwencloud: {
      supports: () => true,
      poll: true,
      cancel: true,
      load: async (settings) => {
        const { buildDashScopeTransport } = await import('./dashscope/dashscopeProvider')

        return buildDashScopeTransport(settings)
      }
    },
    modelscope: {
      supports: () => true,
      poll: true,
      load: async (settings) => {
        const { buildModelscopeTransport } = await import('./modelscope/modelscopeProvider')

        return buildModelscopeTransport(settings)
      }
    },
    dmxapi: {
      supports: dmxapiUsesCustomTransport,
      load: async (settings) => {
        const { buildDmxapiTransport } = await import('./dmxapi/dmxapiProvider')

        return buildDmxapiTransport(settings)
      }
    },
    // ComfyUI owns the whole generation lifecycle: `/prompt` returns a task id, the job
    // polls `/history/{id}` until the graph reports outputs, and cancel is id-scoped.
    // Declaring `poll` + `cancel` here is what lets a running generation be aborted.
    comfyui: {
      supports: () => true,
      poll: true,
      cancel: true,
      load: async (settings) => {
        const { createComfyuiTransport } = await import('./comfyui/comfyuiTransport')

        return createComfyuiTransport(settings)
      }
    },
    tokenhub: {
      supports: () => true,
      poll: true,
      load: async (settings) => {
        const { buildTokenhubTransport } = await import('./tokenhub/tokenhubProvider')

        return buildTokenhubTransport(settings)
      }
    }
  })
)

export function hasImageTransport(providerId: string, modelId: string): boolean {
  return TRANSPORTS.get(providerId)?.supports(modelId) ?? false
}

export function resolveImageTransport(
  config: ImageTransportConfig | undefined,
  modelId: string
): ImageGenerationTransport | null {
  if (!config) return null
  const registration = TRANSPORTS.get(config.providerId)

  return registration?.supports(modelId) ? createLazyTransport(registration, config.providerSettings) : null
}
