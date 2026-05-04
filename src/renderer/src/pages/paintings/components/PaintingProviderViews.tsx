import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { AihubmixHeaderActions } from '../providers/aihubmix/provider'
import { DmxapiSetting } from '../providers/dmxapi/components'
import { DmxapiHeaderActions } from '../providers/dmxapi/provider'
import { NewApiHeaderActions } from '../providers/newapi/provider'
import { NewApiSetting } from '../providers/newapi/sidebar'
import { OvmsHeaderActions } from '../providers/ovms/provider'
import { TokenFluxCenterContent, TokenFluxSetting } from '../providers/tokenflux/components'
import { TokenFluxHeaderActions } from '../providers/tokenflux/provider'
import { ZhipuHeaderActions } from '../providers/zhipu/provider'
import Artboard from './Artboard'

/** Provider-specific links/actions in the settings header row (next to close). */
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

export function PaintingSettingsExtras({
  provider,
  painting,
  modelOptions,
  selectedModelOption,
  patchPainting,
  tab
}: {
  provider: PaintingProviderRuntime
  painting: PaintingData
  modelOptions: ModelOption[]
  selectedModelOption?: ModelOption
  isLoading: boolean
  patchPainting: (updates: Partial<PaintingData>) => void
  tab: string
}) {
  if (provider.id === 'dmxapi') {
    return <DmxapiSetting mode={tab} />
  }

  if (provider.id === 'tokenflux') {
    return (
      <TokenFluxSetting
        painting={painting as any}
        patchPainting={patchPainting as any}
        selectedModel={selectedModelOption?.raw as any}
      />
    )
  }

  if (
    provider.id === 'new-api' ||
    provider.presetProviderId === 'new-api' ||
    ['cherryin', 'aionly'].includes(provider.id)
  ) {
    return (
      <NewApiSetting
        providerId={provider.id}
        painting={painting as any}
        modelOptions={modelOptions}
        patchPainting={patchPainting as any}
        tab={tab}
      />
    )
  }

  return null
}

export function PaintingArtboard({
  painting,
  isLoading,
  onCancel
}: {
  painting: PaintingData
  isLoading: boolean
  onCancel: () => void
}) {
  if (painting.providerId === 'tokenflux') {
    return <TokenFluxCenterContent painting={painting as any} isLoading={isLoading} onCancel={onCancel} />
  }

  return <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
}
