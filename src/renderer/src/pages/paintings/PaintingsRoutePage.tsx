import { loggerService } from '@logger'
import { useAppDispatch } from '@renderer/store'
import { setDefaultPaintingProvider } from '@renderer/store/settings'
import { PaintingProvider } from '@renderer/types'
import { FC, useEffect } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'

import AihubmixPage from './AihubmixPage'
import DmxapiPage from './DmxapiPage'
import NewApiPage from './NewApiPage'
import OvmsPage from './OvmsPage'
import SiliconPage from './SiliconPage'
import TokenFluxPage from './TokenFluxPage'
import ZhipuPage from './ZhipuPage'

const logger = loggerService.withContext('PaintingsRoutePage')

const systemType = await window.api.system.getDeviceType()
const cpuName = await window.api.system.getCpuName()

const Options = ['zhipu', 'aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'new-api', 'ovms'].filter((option) => {
  if (option === 'ovms' && (systemType !== 'windows' || !cpuName.toLowerCase().includes('intel'))) {
    return false
  }
  return true
})

const PaintingsRoutePage: FC = () => {
  const params = useParams()
  const provider = params['*']
  const dispatch = useAppDispatch()

  useEffect(() => {
    logger.debug(`defaultPaintingProvider: ${provider}`)
    if (provider && Options.includes(provider)) {
      dispatch(setDefaultPaintingProvider(provider as PaintingProvider))
    }
  }, [provider, dispatch])

  return (
    <Routes>
      <Route path="*" element={<ZhipuPage Options={Options} />} />
      <Route path="/zhipu" element={<ZhipuPage Options={Options} />} />
      <Route path="/aihubmix" element={<AihubmixPage Options={Options} />} />
      <Route path="/silicon" element={<SiliconPage Options={Options} />} />
      <Route path="/dmxapi" element={<DmxapiPage Options={Options} />} />
      <Route path="/tokenflux" element={<TokenFluxPage Options={Options} />} />
      <Route path="/new-api" element={<NewApiPage Options={Options} />} />
      <Route path="/ovms" element={<OvmsPage Options={Options} />} />
    </Routes>
  )
}

export default PaintingsRoutePage
