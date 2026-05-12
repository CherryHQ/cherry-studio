import { useTranslation } from 'react-i18next'

import { usePaintingProviderRuntime } from '../hooks/usePaintingProviderRuntime'
import type { OpenApiCompatiblePaintingData, PaintingData, TokenFluxPaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { AihubmixHeaderActions } from '../providers/aihubmix'
import { DmxapiHeaderActions, DmxapiSetting } from '../providers/dmxapi'
import { NewApiHeaderActions, NewApiSetting } from '../providers/newapi'
import { OvmsHeaderActions } from '../providers/ovms'
import { TokenFluxCenterContent, TokenFluxHeaderActions, TokenFluxSetting } from '../providers/tokenflux'
import type { TokenFluxModel } from '../providers/tokenflux/config'
import { ZhipuHeaderActions } from '../providers/zhipu'
import Artboard from './Artboard'

const NON_OPENAPI_PROVIDER_IDS = new Set(['aihubmix', 'dmxapi', 'ovms', 'ppio', 'silicon', 'tokenflux', 'zhipu'])

function isTokenFluxPainting(painting: PaintingData): painting is TokenFluxPaintingData {
  return painting.providerId === 'tokenflux'
}

function isTokenFluxModel(value: unknown): value is TokenFluxModel {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'input_schema' in value)
}

function isOpenApiCompatiblePainting(painting: PaintingData): painting is OpenApiCompatiblePaintingData {
  return !NON_OPENAPI_PROVIDER_IDS.has(painting.providerId)
}

/** Provider-specific links/actions in the settings header row (next to close). */
export function PaintingProviderHeaderActions({ providerId }: { providerId: string }) {
  const { t } = useTranslation()
  const { provider } = usePaintingProviderRuntime(providerId)

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
    return <DmxapiSetting paintingId={painting.id} mode={tab} />
  }

  if (provider.id === 'tokenflux') {
    if (!isTokenFluxPainting(painting)) {
      return null
    }

    return (
      <TokenFluxSetting
        painting={painting}
        patchPainting={(updates) => patchPainting(updates as Partial<PaintingData>)}
        selectedModel={isTokenFluxModel(selectedModelOption?.raw) ? selectedModelOption.raw : undefined}
      />
    )
  }

  if (
    provider.id === 'new-api' ||
    provider.presetProviderId === 'new-api' ||
    ['cherryin', 'aionly'].includes(provider.id)
  ) {
    if (!isOpenApiCompatiblePainting(painting)) {
      return null
    }

    return (
      <NewApiSetting
        providerId={provider.id}
        painting={painting}
        modelOptions={modelOptions}
        patchPainting={(updates) => patchPainting(updates as Partial<PaintingData>)}
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
  if (isTokenFluxPainting(painting)) {
    return <TokenFluxCenterContent painting={painting} isLoading={isLoading} onCancel={onCancel} />
  }

  return <Artboard painting={painting} isLoading={isLoading} onCancel={onCancel} />
}
