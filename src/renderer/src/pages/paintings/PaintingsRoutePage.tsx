import { loggerService } from '@logger'
import { isNewApiProvider } from '@renderer/config/providers'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useAppDispatch } from '@renderer/store'
import { setDefaultPaintingProvider } from '@renderer/store/settings'
import { PaintingProvider, SystemProviderId } from '@renderer/types'
import { FC, useEffect, useMemo, useState } from 'react'
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
  const [ovmsStatus, setOvmsStatus] = useState<'not-installed' | 'not-running' | 'running'>('not-running')

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
    }
  }, [provider, dispatch, validOptions])

  return (
    <Routes>
      <Route path="*" element={<ZhipuPage Options={validOptions} />} />
      <Route path="/zhipu" element={<ZhipuPage Options={validOptions} />} />
      <Route path="/aihubmix" element={<AihubmixPage Options={validOptions} />} />
      <Route path="/silicon" element={<SiliconPage Options={validOptions} />} />
      <Route path="/dmxapi" element={<DmxapiPage Options={validOptions} />} />
      <Route path="/tokenflux" element={<TokenFluxPage Options={validOptions} />} />
      <Route path="/ovms" element={<OvmsPage Options={validOptions} />} />
      {/* new-api family providers are mounted dynamically below */}
      {providers
        .filter((p) => isNewApiProvider(p))
        .map((p) => (
          <Route key={p.id} path={`/${p.id}`} element={<NewApiPage Options={validOptions} />} />
        ))}
      <Route path="/new-api" element={<NewApiPage Options={validOptions} />} />
    </Routes>
  )
}

export default PaintingsRoutePage
