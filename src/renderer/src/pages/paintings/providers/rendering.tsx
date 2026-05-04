import { useTranslation } from 'react-i18next'

import Artboard from '../components/Artboard'
import type { ModelOption } from '../hooks/useModelLoader'
import type { PaintingData } from '../model/types/paintingData'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { AihubmixHeaderActions } from './aihubmix/provider'
import { DmxapiSidebarContent } from './dmxapi/components'
import { DmxapiHeaderActions } from './dmxapi/provider'
import { NewApiHeaderActions } from './newapi/provider'
import { NewApiSidebarContent } from './newapi/sidebar'
import { OvmsHeaderActions } from './ovms/provider'
import { TokenFluxCenterContent, TokenFluxSidebarContent } from './tokenflux/components'
import { TokenFluxHeaderActions } from './tokenflux/provider'
import { ZhipuHeaderActions } from './zhipu/provider'

export function PaintingProviderHeaderActions({ provider }: { provider: PaintingProviderRuntime }) {
  const { t } = useTranslation()

  if (provider.id === 'zhipu') return <ZhipuHeaderActions t={t} />
  if (provider.id === 'aihubmix') return <AihubmixHeaderActions provider={provider} t={t} />
  if (provider.id === 'ovms') return <OvmsHeaderActions t={t} />
  if (provider.id === 'dmxapi') return <DmxapiHeaderActions t={t} />
  if (provider.id === 'tokenflux') return <TokenFluxHeaderActions t={t} />
  if (
    provider.id === 'new-api' ||
    provider.presetProviderId === 'new-api' ||
    ['cherryin', 'aionly'].includes(provider.id)
  ) {
    return <NewApiHeaderActions provider={provider} t={t} />
  }
  return null
}

export function PaintingProviderSidebarContent({
  provider,
  painting,
  modelOptions,
  patchPainting,
  tab
}: {
  provider: PaintingProviderRuntime
  painting: PaintingData
  modelOptions: ModelOption[]
  isLoading: boolean
  patchPainting: (updates: Partial<PaintingData>) => void
  tab: string
}) {
  const { t } = useTranslation()

  if (provider.id === 'dmxapi') {
    return <DmxapiSidebarContent mode={tab} t={t} />
  }

  if (provider.id === 'tokenflux') {
    return (
      <TokenFluxSidebarContent
        painting={painting as any}
        patchPainting={patchPainting as any}
        modelOptions={modelOptions}
        t={t}
      />
    )
  }

  if (
    provider.id === 'new-api' ||
    provider.presetProviderId === 'new-api' ||
    ['cherryin', 'aionly'].includes(provider.id)
  ) {
    return (
      <NewApiSidebarContent
        providerId={provider.id}
        painting={painting as any}
        modelOptions={modelOptions}
        patchPainting={patchPainting as any}
        tab={tab}
        t={t}
      />
    )
  }

  return null
}

export function PaintingArtboard({
  provider,
  painting,
  isLoading,
  onCancel
}: {
  provider: PaintingProviderRuntime
  painting: PaintingData
  isLoading: boolean
  onCancel: () => void
}) {
  if (provider.id === 'tokenflux') {
    return <TokenFluxCenterContent painting={painting as any} isLoading={isLoading} onCancel={onCancel} />
  }

  return <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
}
