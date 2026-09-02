import { dmxapiUsesCustomTransport } from './dmxapi/dmxapiImageRouting'
import type { ImageGenerationTransport } from './imageGenerationModel'

interface TransportRegistration {
  supports: (modelId: string) => boolean
  load: (providerSettings: unknown) => Promise<ImageGenerationTransport>
  poll?: boolean
  cancel?: boolean
}

function createLazyTransport(registration: TransportRegistration, providerSettings: unknown): ImageGenerationTransport {
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

const TRANSPORTS: Record<string, TransportRegistration> = {
  ppio: {
    supports: () => true,
    poll: true,
    load: async (settings) => {
      const { buildPpioTransport } = await import('./ppio/ppioProvider')
      return buildPpioTransport(settings as Parameters<typeof buildPpioTransport>[0])
    }
  },
  dashscope: {
    supports: () => true,
    poll: true,
    cancel: true,
    load: async (settings) => {
      const { buildDashScopeTransport } = await import('./dashscope/dashscopeProvider')
      return buildDashScopeTransport(settings as Parameters<typeof buildDashScopeTransport>[0])
    }
  },
  // QwenCloud (international) serves the same DashScope AIGC endpoints under
  // dashscope-intl.aliyuncs.com — the transport is identical, only the origin
  // differs (derived into `imageBaseURL` by the provider config builder).
  qwencloud: {
    supports: () => true,
    poll: true,
    cancel: true,
    load: async (settings) => {
      const { buildDashScopeTransport } = await import('./dashscope/dashscopeProvider')
      return buildDashScopeTransport(settings as Parameters<typeof buildDashScopeTransport>[0])
    }
  },
  modelscope: {
    supports: () => true,
    poll: true,
    load: async (settings) => {
      const { buildModelscopeTransport } = await import('./modelscope/modelscopeProvider')
      return buildModelscopeTransport(settings as Parameters<typeof buildModelscopeTransport>[0])
    }
  },
  dmxapi: {
    supports: dmxapiUsesCustomTransport,
    load: async (settings) => {
      const { buildDmxapiTransport } = await import('./dmxapi/dmxapiProvider')
      return buildDmxapiTransport(settings as Parameters<typeof buildDmxapiTransport>[0])
    }
  },
  tokenhub: {
    supports: () => true,
    poll: true,
    load: async (settings) => {
      const { buildTokenhubTransport } = await import('./tokenhub/tokenhubProvider')
      return buildTokenhubTransport(settings as Parameters<typeof buildTokenhubTransport>[0])
    }
  }
}

export function hasImageTransport(providerId: string, modelId: string): boolean {
  return TRANSPORTS[providerId]?.supports(modelId) ?? false
}

export function resolveImageTransport(
  aiSdkProviderId: string,
  modelId: string,
  providerSettings: unknown
): ImageGenerationTransport | null {
  const registration = TRANSPORTS[aiSdkProviderId]
  return registration?.supports(modelId) ? createLazyTransport(registration, providerSettings) : null
}
