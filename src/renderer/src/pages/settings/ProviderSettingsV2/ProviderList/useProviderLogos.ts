import { loggerService } from '@logger'
import ImageStorage from '@renderer/services/ImageStorage'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useProviderLogos')

export function useProviderLogos(providers: Provider[]) {
  const [logos, setLogos] = useState<Record<string, string>>({})

  useEffect(() => {
    const load = async () => {
      const entries = await Promise.all(
        providers.map(async (provider) => {
          try {
            const logo = await ImageStorage.get(`provider-${provider.id}`)
            return logo ? ([provider.id, logo] as const) : null
          } catch (error) {
            logger.error(`Failed to load logo for provider ${provider.id}`, error as Error)
            return null
          }
        })
      )

      setLogos(Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null)))
    }

    void load()
  }, [providers])

  const saveLogo = useCallback(async (providerId: string, logo: string) => {
    await ImageStorage.set(`provider-${providerId}`, logo)
    setLogos((previous) => ({ ...previous, [providerId]: logo }))
  }, [])

  const clearLogo = useCallback(async (providerId: string) => {
    await ImageStorage.set(`provider-${providerId}`, '')
    setLogos((previous) => {
      const next = { ...previous }
      delete next[providerId]
      return next
    })
  }, [])

  return { logos, saveLogo, clearLogo }
}
