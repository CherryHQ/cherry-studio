import { loggerService } from '@logger'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useAppDispatch } from '@renderer/store'
import { setDefaultPaintingProvider } from '@renderer/store/settings'
import { updateTab } from '@renderer/store/tabs'
import type { PaintingProvider, SystemProviderId } from '@renderer/types'
import { isNewApiProvider } from '@renderer/utils/provider'
import type { FC } from 'react'
import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'

// Lazy load painting pages for code splitting
const AihubmixPage = React.lazy(() => import('./AihubmixPage'))
const DmxapiPage = React.lazy(() => import('./DmxapiPage'))
const NewApiPage = React.lazy(() => import('./NewApiPage'))
const OvmsPage = React.lazy(() => import('./OvmsPage'))
const PpioPage = React.lazy(() => import('./PpioPage'))
const SiliconPage = React.lazy(() => import('./SiliconPage'))
const TokenFluxPage = React.lazy(() => import('./TokenFluxPage'))
const ZhipuPage = React.lazy(() => import('./ZhipuPage'))

// Loading fallback component
const PaintingPageFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
    Loading...
  </div>
)

const logger = loggerService.withContext('PaintingsRoutePage')

const BASE_OPTIONS: SystemProviderId[] = ['zhipu', 'aihubmix', 'silicon', 'dmxapi', 'tokenflux', 'ovms', 'ppio']

const PaintingsRoutePage: FC = () => {
  const params = useParams()
  const provider = params['*']
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
    void checkStatus()
  }, [])

  const validOptions = Options.filter((option) => option !== 'ovms' || ovmsStatus === 'running')

  useEffect(() => {
    logger.debug(`defaultPaintingProvider: ${provider}`)
    if (provider && validOptions.includes(provider)) {
      dispatch(setDefaultPaintingProvider(provider as PaintingProvider))
      dispatch(updateTab({ id: 'paintings', updates: { path: `/paintings/${provider}` } }))
    }
  }, [provider, dispatch, validOptions])

  return (
    <Suspense fallback={<PaintingPageFallback />}>
      <Routes>
        <Route path="*" element={<NewApiPage Options={validOptions} />} />
        <Route path="/zhipu" element={<ZhipuPage Options={validOptions} />} />
        <Route path="/aihubmix" element={<AihubmixPage Options={validOptions} />} />
        <Route path="/silicon" element={<SiliconPage Options={validOptions} />} />
        <Route path="/dmxapi" element={<DmxapiPage Options={validOptions} />} />
        <Route path="/tokenflux" element={<TokenFluxPage Options={validOptions} />} />
        <Route path="/ovms" element={<OvmsPage Options={validOptions} />} />
        <Route path="/ppio" element={<PpioPage Options={validOptions} />} />
        <Route path="/new-api" element={<NewApiPage Options={validOptions} />} />
        {/* new-api family providers are mounted dynamically below */}
        {newApiProviders.map((p) => (
          <Route key={p.id} path={`/${p.id}`} element={<NewApiPage Options={validOptions} />} />
        ))}
      </Routes>
    </Suspense>
  )
}

export default PaintingsRoutePage
