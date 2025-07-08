import { useAppDispatch } from '@renderer/store'
import { setDefaultPaintingProvider } from '@renderer/store/settings'
import { PaintingProvider } from '@renderer/types'
import { FC, useEffect } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'

import AihubmixPage from './AihubmixPage'
import DmxapiPage from './DmxapiPage'
import NewApiPage from './NewApiPage'
import SiliconPage from './SiliconPage'
import TokenFluxPage from './TokenFluxPage'

const Options = ['aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'new-api']

const PaintingsRoutePage: FC = () => {
  const params = useParams()
  const provider = params['*']
  const dispatch = useAppDispatch()

  useEffect(() => {
    console.debug('defaultPaintingProvider', provider)
    if (provider && Options.includes(provider)) {
      dispatch(setDefaultPaintingProvider(provider as PaintingProvider))
    }
  }, [provider, dispatch])

  return (
    <Routes>
      <Route path="*" element={<AihubmixPage Options={Options} />} />
      <Route path="/aihubmix" element={<AihubmixPage Options={Options} />} />
      <Route path="/silicon" element={<SiliconPage Options={Options} />} />
      <Route path="/dmxapi" element={<DmxapiPage Options={Options} />} />
      <Route path="/tokenflux" element={<TokenFluxPage Options={Options} />} />
      <Route path="/new-api" element={<NewApiPage Options={Options} />} />
    </Routes>
  )
}

export default PaintingsRoutePage
