import { loggerService } from '@logger'
import { isNewApiProvider } from '@renderer/config/providers'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useAppDispatch } from '@renderer/store'
import { setDefaultPaintingProvider } from '@renderer/store/settings'
import { PaintingProvider, SystemProviderId } from '@renderer/types'
import { FC, useEffect, useMemo } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'

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
  const params = useParams()
  const provider = params['*']
  const dispatch = useAppDispatch()
  const providers = useAllProviders()
  const Options = useMemo(() => {
    return [...BASE_OPTIONS, ...providers.filter((p) => isNewApiProvider(p)).map((p) => p.id)]
  }, [providers])

  useEffect(() => {
    logger.debug(`defaultPaintingProvider: ${provider}`)
    if (provider && Options.includes(provider)) {
      dispatch(setDefaultPaintingProvider(provider as PaintingProvider))
    }
  }, [provider, dispatch, Options])

  return (
    <Routes>
      <Route path="*" element={<ZhipuPage Options={Options} />} />
      <Route path="/zhipu" element={<ZhipuPage Options={Options} />} />
      <Route path="/aihubmix" element={<AihubmixPage Options={Options} />} />
      <Route path="/silicon" element={<SiliconPage Options={Options} />} />
      <Route path="/dmxapi" element={<DmxapiPage Options={Options} />} />
      <Route path="/tokenflux" element={<TokenFluxPage Options={Options} />} />
      <Route path="/ovms" element={<OvmsPage Options={Options} />} />
      {/* new-api family providers are mounted dynamically below */}
      {providers
        .filter((p) => isNewApiProvider(p))
        .map((p) => (
          <Route key={p.id} path={`/${p.id}`} element={<NewApiPage Options={Options} />} />
        ))}
      <Route path="/new-api" element={<NewApiPage Options={Options} />} />      
    </Routes>
  )
}

export default PaintingsRoutePage
