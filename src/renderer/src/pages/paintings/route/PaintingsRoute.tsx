import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useAllProviders } from '@renderer/hooks/useProvider'
import NavigationService from '@renderer/services/NavigationService'
import type { SystemProviderId } from '@renderer/types'
import { isNewApiProvider } from '@renderer/utils/provider'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { providerRegistry } from '../providers'
import { createNewApiProvider } from '../providers/newapi'
import { getValidPaintingOptions, resolvePaintingProvider } from '../utils/providerSelection'
import PaintingWorkspace from '../workspace/PaintingWorkspace'

const logger = loggerService.withContext('PaintingsRoute')

const BASE_OPTIONS: SystemProviderId[] = ['zhipu', 'aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'ovms', 'ppio']
const FALLBACK_PROVIDER = 'zhipu'

const PaintingsRoute: FC = () => {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const requestedProvider = params._splat

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  const providers = useAllProviders()
  const [defaultPaintingProvider, setDefaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  const [activeProvider, setActiveProvider] = useState<string>(
    requestedProvider || defaultPaintingProvider || FALLBACK_PROVIDER
  )
  const [isOvmsSupported, setIsOvmsSupported] = useState(false)
  const [ovmsStatus, setOvmsStatus] = useState<'not-installed' | 'not-running' | 'running'>('not-running')

  const options = useMemo(() => [...BASE_OPTIONS, ...providers.filter(isNewApiProvider).map((p) => p.id)], [providers])

  useEffect(() => {
    const checkOvms = async () => {
      const supported = await window.api.ovms.isSupported()
      setIsOvmsSupported(supported)
      if (supported) {
        const status = await window.api.ovms.getStatus()
        setOvmsStatus(status)
      }
    }
    void checkOvms()
  }, [])

  const validOptions = useMemo(
    () => getValidPaintingOptions(options, isOvmsSupported, ovmsStatus),
    [options, isOvmsSupported, ovmsStatus]
  )

  useEffect(() => {
    const nextProvider = resolvePaintingProvider(requestedProvider, defaultPaintingProvider, validOptions)

    logger.debug(`defaultPaintingProvider: ${nextProvider}`)
    if (nextProvider && nextProvider !== activeProvider) {
      setActiveProvider(nextProvider)
    }

    if (nextProvider && nextProvider !== requestedProvider) {
      void navigate({ to: `/app/paintings/${nextProvider}`, replace: true })
    }

    if (nextProvider && nextProvider !== defaultPaintingProvider) {
      void setDefaultPaintingProvider(nextProvider)
    }
  }, [activeProvider, defaultPaintingProvider, navigate, requestedProvider, setDefaultPaintingProvider, validOptions])

  const handleProviderChange = (providerId: string) => {
    if (!validOptions.includes(providerId) || providerId === activeProvider) {
      return
    }

    setActiveProvider(providerId)
    void navigate({ to: `/app/paintings/${providerId}` })
    void setDefaultPaintingProvider(providerId)
  }

  const definition = useMemo(
    () => providerRegistry[activeProvider] ?? createNewApiProvider(activeProvider || 'new-api'),
    [activeProvider]
  )

  if (!activeProvider) {
    return null
  }

  if (activeProvider === 'ovms' && !isOvmsSupported) {
    return null
  }

  return (
    <PaintingWorkspace
      key={activeProvider}
      definition={definition}
      options={validOptions}
      onProviderChange={handleProviderChange}
    />
  )
}

export default PaintingsRoute
