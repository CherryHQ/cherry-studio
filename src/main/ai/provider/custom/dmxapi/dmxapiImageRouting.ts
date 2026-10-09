type DmxapiNativeImageFamily = 'openai-compat-image' | 'openai-native' | 'gemini-native'

export type DmxapiFamily = 'openai-flat' | 'responses-string' | 'responses-messages' | 'openai-flat-async'

export interface DmxapiCustomImageBinding {
  modelId: string
  family: Exclude<DmxapiFamily, 'openai-flat'>
}

export type DmxapiImageBinding =
  | { kind: 'custom'; binding: DmxapiCustomImageBinding }
  | { kind: 'sdk'; modelId: string; family: DmxapiNativeImageFamily }

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
  return resolveDmxapiImageBinding(modelId).kind === 'custom'
}

export function resolveDmxapiImageBinding(modelId: string): DmxapiImageBinding {
  const nativeFamily = resolveDmxapiNativeImageFamily(modelId)
  if (nativeFamily !== 'openai-compat-image') return { kind: 'sdk', modelId, family: nativeFamily }
  const family = resolveDmxapiFamily(modelId)
  if (family === 'openai-flat') return { kind: 'sdk', modelId, family: nativeFamily }
  return { kind: 'custom', binding: { modelId, family } }
}
