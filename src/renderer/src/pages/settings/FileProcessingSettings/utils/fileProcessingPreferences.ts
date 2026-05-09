import type {
  FileProcessorFeature,
  FileProcessorId,
  FileProcessorOptions,
  FileProcessorOverride,
  FileProcessorOverrides
} from '@shared/data/preference/preferenceTypes'

function setProcessorOverride(
  overrides: FileProcessorOverrides,
  processorId: FileProcessorId,
  override: FileProcessorOverride | undefined
): FileProcessorOverrides {
  const nextOverrides = { ...overrides }

  if (override) {
    nextOverrides[processorId] = override
  } else {
    delete nextOverrides[processorId]
  }

  return nextOverrides
}

function omitEmptyOptions(options: FileProcessorOptions | undefined): FileProcessorOptions | undefined {
  if (!options) {
    return undefined
  }

  const entries = Object.entries(options).filter(([, value]) => {
    if (Array.isArray(value)) {
      return value.length > 0
    }

    return value !== undefined
  })

  return entries.length ? Object.fromEntries(entries) : undefined
}

function omitEmptyCapability(
  capability: NonNullable<FileProcessorOverride['capabilities']>[FileProcessorFeature] | undefined
) {
  if (!capability) {
    return undefined
  }

  const apiHost = capability.apiHost?.trim()
  const modelId = capability.modelId?.trim()

  if (!apiHost && !modelId) {
    return undefined
  }

  return {
    ...(apiHost ? { apiHost } : {}),
    ...(modelId ? { modelId } : {})
  }
}

function omitEmptyOverride(override: FileProcessorOverride): FileProcessorOverride | undefined {
  const apiKeys = override.apiKeys?.map((item) => item.trim()).filter(Boolean)
  const capabilitiesEntries = override.capabilities
    ? (
        Object.entries(override.capabilities) as Array<
          [FileProcessorFeature, NonNullable<FileProcessorOverride['capabilities']>[FileProcessorFeature]]
        >
      )
        .map(([feature, capability]) => [feature, omitEmptyCapability(capability)] as const)
        .filter(
          (entry): entry is readonly [FileProcessorFeature, NonNullable<ReturnType<typeof omitEmptyCapability>>] =>
            Boolean(entry[1])
        )
    : undefined
  const options = omitEmptyOptions(override.options)

  if (!apiKeys?.length && !capabilitiesEntries?.length && !options) {
    return undefined
  }

  return {
    ...(apiKeys?.length ? { apiKeys } : {}),
    ...(capabilitiesEntries?.length ? { capabilities: Object.fromEntries(capabilitiesEntries) } : {}),
    ...(options ? { options } : {})
  }
}

export function updateProcessorApiKeys(
  overrides: FileProcessorOverrides,
  processorId: FileProcessorId,
  apiKeys: string[]
): FileProcessorOverrides {
  const current = overrides[processorId] ?? {}
  const next = omitEmptyOverride({ ...current, apiKeys })

  return setProcessorOverride(overrides, processorId, next)
}

export function updateProcessorCapabilityOverride(
  overrides: FileProcessorOverrides,
  processorId: FileProcessorId,
  feature: FileProcessorFeature,
  field: 'apiHost' | 'modelId',
  value: string
): FileProcessorOverrides {
  const current = overrides[processorId] ?? {}
  const currentCapability = current.capabilities?.[feature] ?? {}
  const nextCapability = {
    ...currentCapability,
    [field]: value.trim()
  }
  const nextCapabilities = {
    ...current.capabilities,
    [feature]: nextCapability
  }
  const next = omitEmptyOverride({
    ...current,
    capabilities: nextCapabilities
  })

  return setProcessorOverride(overrides, processorId, next)
}

export function getProcessorLanguageOptions(options: FileProcessorOptions | undefined): string[] {
  const langs = options?.langs
  return Array.isArray(langs) ? langs.filter((lang): lang is string => typeof lang === 'string') : []
}

export function updateProcessorLanguageOptions(
  overrides: FileProcessorOverrides,
  processorId: Extract<FileProcessorId, 'system' | 'tesseract'>,
  langs: string[]
): FileProcessorOverrides {
  const current = overrides[processorId] ?? {}
  const next = omitEmptyOverride({
    ...current,
    options: {
      ...current.options,
      langs
    }
  })

  return setProcessorOverride(overrides, processorId, next)
}
