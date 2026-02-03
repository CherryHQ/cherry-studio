import { loggerService } from '@logger'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useAppDispatch } from '@renderer/store'
import { setDefaultPaintingProvider } from '@renderer/store/settings'
import { updateTab } from '@renderer/store/tabs'
import type { PaintingProvider, SystemProviderId } from '@renderer/types'
import { isNewApiProvider } from '@renderer/utils/provider'
import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'

import AihubmixPage from './AihubmixPage'
import DmxapiPage from './DmxapiPage'
import NewApiPage from './NewApiPage'
import OvmsPage from './OvmsPage'
import SiliconPage from './SiliconPage'
import TokenFluxPage from './TokenFluxPage'
import ZhipuPage from './ZhipuPage'

const logger = loggerService.withContext('PaintingsRoutePage')

const BASE_OPTIONS: SystemProviderId[] = ['zhipu', 'aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'ovms']

const PaintingsRoutePage: FC = () => {
  const params = useParams({ strict: false }) as { _splat?: string }
  const provider = params._splat
  const dispatch = useAppDispatch()
  const providers = useAllProviders()
  const [ovmsStatus, setOvmsStatus] = useState<'not-installed' | 'not-running' | 'running'>('not-running')

  const Options = useMemo(() => [...BASE_OPTIONS, ...providers.filter(isNewApiProvider).map((p) => p.id)], [providers])
  const newApiProviders = useMemo(() => providers.filter(isNewApiProvider), [providers])

  useEffect(() => {
    const checkStatus = async () => {
      const status = await window.api.ovms.getStatus()
      setOvmsStatus(status)
    }
    checkStatus()
  }, [])

  const validOptions = Options.filter((option) => option !== 'ovms' || ovmsStatus === 'running')

  useEffect(() => {
    logger.debug(`defaultPaintingProvider: ${provider}`)
    if (provider && validOptions.includes(provider)) {
      dispatch(setDefaultPaintingProvider(provider as PaintingProvider))
      dispatch(updateTab({ id: 'paintings', updates: { path: `/paintings/${provider}` } }))
    }
  }, [provider, dispatch, validOptions])

  // 根据 provider 渲染对应的页面
  const renderPage = () => {
    switch (provider) {
      case 'zhipu':
        return <ZhipuPage Options={validOptions} />
      case 'aihubmix':
        return <AihubmixPage Options={validOptions} />
      case 'silicon':
        return <SiliconPage Options={validOptions} />
      case 'dmxapi':
        return <DmxapiPage Options={validOptions} />
      case 'tokenflux':
        return <TokenFluxPage Options={validOptions} />
      case 'ovms':
        return <OvmsPage Options={validOptions} />
      case 'new-api':
        return <NewApiPage Options={validOptions} />
      default:
        // 检查是否是 new-api 家族的 provider
        if (provider && newApiProviders.some((p) => p.id === provider)) {
          return <NewApiPage Options={validOptions} />
        }
        // 默认页面
        return <NewApiPage Options={validOptions} />
    }
  }

  return renderPage()
}

export default PaintingsRoutePage
