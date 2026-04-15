import { loggerService } from '@logger'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setDefaultPaintingProvider } from '@renderer/store/settings'
import type { PaintingProvider, SystemProviderId } from '@renderer/types'
import { isNewApiProvider } from '@renderer/utils/provider'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'

import PaintingPage from './PaintingPage'
import { providerRegistry } from './providers'
import { createNewApiProvider } from './providers/newApiProvider'
import { getValidPaintingOptions, resolvePaintingProvider } from './utils/providerSelection'

const logger = loggerService.withContext('PaintingsPage')

const BASE_OPTIONS: SystemProviderId[] = ['zhipu', 'aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'ovms', 'ppio']

const PaintingsPage: FC = () => {
  const dispatch = useAppDispatch()
  const providers = useAllProviders()
  const defaultPaintingProvider = useAppSelector((state) => state.settings.defaultPaintingProvider)
  const [activeProvider, setActiveProvider] = useState<string>(defaultPaintingProvider)
  const [isOvmsSupported, setIsOvmsSupported] = useState(false)
  const [ovmsStatus, setOvmsStatus] = useState<'not-installed' | 'not-running' | 'running'>('not-running')

  const Options = useMemo(() => [...BASE_OPTIONS, ...providers.filter(isNewApiProvider).map((p) => p.id)], [providers])

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
    () => getValidPaintingOptions(Options, isOvmsSupported, ovmsStatus),
    [Options, isOvmsSupported, ovmsStatus]
  )

  useEffect(() => {
    const nextProvider = resolvePaintingProvider(activeProvider, defaultPaintingProvider, validOptions)

    logger.debug(`defaultPaintingProvider: ${nextProvider}`)
    if (nextProvider && nextProvider !== activeProvider) {
      setActiveProvider(nextProvider)
    }

    if (nextProvider && nextProvider !== defaultPaintingProvider) {
      dispatch(setDefaultPaintingProvider(nextProvider as PaintingProvider))
    }
  }, [activeProvider, defaultPaintingProvider, dispatch, validOptions])

  const handleProviderChange = (providerId: string) => {
    if (!validOptions.includes(providerId) || providerId === activeProvider) {
      return
    }

    setActiveProvider(providerId)
    dispatch(setDefaultPaintingProvider(providerId as PaintingProvider))
  }

  const newApiDefinition = useMemo(() => createNewApiProvider(activeProvider || 'new-api'), [activeProvider])

  if (!activeProvider) {
    return null
  }

  // Render corresponding page based on provider
  if (activeProvider === 'ovms') {
    if (!isOvmsSupported) return null
    return (
      <PaintingPage
        key="ovms"
        definition={providerRegistry.ovms}
        Options={validOptions}
        onProviderChange={handleProviderChange}
      />
    )
  }

  if (providerRegistry[activeProvider]) {
    return (
      <PaintingPage
        key={activeProvider}
        definition={providerRegistry[activeProvider]}
        Options={validOptions}
        onProviderChange={handleProviderChange}
      />
    )
  }

  // new-api family (includes 'new-api' literal and custom new-api providers)
  return (
    <PaintingPage
      key={activeProvider}
      definition={newApiDefinition}
      Options={validOptions}
      onProviderChange={handleProviderChange}
    />
  )
}

export default PaintingsPage
