import { loggerService } from '@logger'
import ImageStorage from '@renderer/services/ImageStorage'
import { mutate } from 'swr'
import useSWRImmutable from 'swr/immutable'

const logger = loggerService.withContext('useProviderLogo')

const getProviderLogoStorageKey = (providerId: string) => `provider-${providerId}`
const getProviderLogoCacheKey = (providerId: string) => `provider-logo/${providerId}`

async function loadProviderLogo(providerId: string): Promise<string | undefined> {
  try {
    const logo = await ImageStorage.get(getProviderLogoStorageKey(providerId))
    return logo || undefined
  } catch (error) {
    logger.error(`Failed to load logo for provider ${providerId}`, error as Error)
    return undefined
  }
}

export function useProviderLogo(providerId?: string) {
  const cacheKey = providerId ? getProviderLogoCacheKey(providerId) : null
  const { data } = useSWRImmutable(cacheKey, () => loadProviderLogo(providerId!))

  return { logo: data }
}

export async function saveProviderLogo(providerId: string, logo: string) {
  await ImageStorage.set(getProviderLogoStorageKey(providerId), logo)
  await mutate(getProviderLogoCacheKey(providerId), logo, { revalidate: false })
}

export async function clearProviderLogo(providerId: string) {
  await ImageStorage.set(getProviderLogoStorageKey(providerId), '')
  await mutate(getProviderLogoCacheKey(providerId), undefined, { revalidate: false })
}

export async function removeProviderLogo(providerId: string) {
  await ImageStorage.remove(getProviderLogoStorageKey(providerId))
  await mutate(getProviderLogoCacheKey(providerId), undefined, { revalidate: false })
}
