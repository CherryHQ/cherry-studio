type DmxapiNativeImageFamily = 'openai-compat-image' | 'openai-native' | 'gemini-native'

export type DmxapiFamily = 'openai-flat' | 'responses-string' | 'responses-messages' | 'openai-flat-async'

const DMXAPI_FAMILY_TABLE: Array<{
  family: Exclude<DmxapiFamily, 'openai-flat'>
  match: (modelId: string) => boolean
}> = [
  { family: 'responses-string', match: (id) => id.startsWith('doubao-seedream') },
  { family: 'responses-messages', match: (id) => /^wan\d/i.test(id) },
  { family: 'openai-flat-async', match: (id) => id.startsWith('qwen-image') }
]

const NATIVE_IMAGE_FAMILY_TABLE: Array<{
  family: Exclude<DmxapiNativeImageFamily, 'openai-compat-image'>
  match: (modelId: string) => boolean
}> = [
  { family: 'openai-native', match: (id) => /^(gpt-image|dall-e)/i.test(id) },
  { family: 'gemini-native', match: (id) => /^imagen-/i.test(id) || /^gemini-.*image/i.test(id) }
]

export function resolveDmxapiNativeImageFamily(modelId: string): DmxapiNativeImageFamily {
  return NATIVE_IMAGE_FAMILY_TABLE.find((entry) => entry.match(modelId))?.family ?? 'openai-compat-image'
}

export function resolveDmxapiFamily(modelId: string): DmxapiFamily {
  return DMXAPI_FAMILY_TABLE.find((entry) => entry.match(modelId))?.family ?? 'openai-flat'
}

export function dmxapiUsesCustomTransport(modelId: string): boolean {
  return (
    resolveDmxapiNativeImageFamily(modelId) === 'openai-compat-image' && resolveDmxapiFamily(modelId) !== 'openai-flat'
  )
}
